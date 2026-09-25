/**
 * Unofficial Garmin Connect session client (email/password once, tokens reused).
 * Login + MFA follow the current mobile SSO flow; wellness GETs use oauth2.
 * This can break if Garmin changes SSO — same class of risk as other Connect libs.
 */

import { createHmac, randomBytes } from "node:crypto";

const CLIENT_ID = "GCM_ANDROID_DARK";
const OAUTH_CONSUMER_URL =
  "https://thegarth.s3.amazonaws.com/oauth_consumer.json";
const OAUTH_USER_AGENT = "com.garmin.android.apps.connectmobile";
const SSO_PAGE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const SSO_SUCCESSFUL = "SUCCESSFUL";
const SSO_MFA_REQUIRED = "MFA_REQUIRED";
const MFA_TTL_MS = 10 * 60 * 1000;
const DOMAIN = "garmin.com";

export type Oauth1Token = {
  oauth_token: string;
  oauth_token_secret: string;
  mfa_token?: string;
};

export type Oauth2Token = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
};

export type GarminStoredTokens = {
  oauth1: Oauth1Token;
  oauth2: Oauth2Token;
};

export type GarminPendingMfa = {
  cookies: Record<string, string>;
  mfaMethod: string;
  createdAt: number;
  flow?: "mobile" | "widget";
  csrf?: string;
  referer?: string;
};

export type GarminLoginResult =
  | { ok: true; tokens: GarminStoredTokens; displayName: string | null }
  | { ok: false; mfaRequired: true; pending: GarminPendingMfa };

export type GarminSocialIdentity = {
  displayName: string | null;
  userProfilePk: number | null;
};

export type GarminGearItem = {
  uuid: string;
  displayName: string;
  customMakeModel: string | null;
  gearMakeName: string | null;
  gearModelName: string | null;
  gearTypeName: string | null;
  dateBegin: Date | null;
  dateEnd: Date | null;
  retired: boolean;
  raw: Record<string, unknown>;
};

export type GarminDevice = {
  displayName: string;
  lastUsedAt: number | null;
  primary: boolean;
  watchLike: boolean;
};

export type GarminDayWellness = {
  overnightHrv: number | null;
  sleepScore: number | null;
  sleepHours: number | null;
  restingHr: number | null;
  stress: number | null;
};

export class GarminAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GarminAuthError";
  }
}

type OauthConsumer = { consumer_key: string; consumer_secret: string };

let consumerCache: OauthConsumer | null = null;

class CookieJar {
  readonly cookies = new Map<string, string>();

  static fromRecord(record: Record<string, string>): CookieJar {
    const jar = new CookieJar();
    for (const [k, v] of Object.entries(record)) jar.cookies.set(k, v);
    return jar;
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries(this.cookies.entries());
  }

  capture(response: Response): void {
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : collectSetCookie(response.headers);
    for (const raw of setCookies) {
      const first = raw.split(";")[0];
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function collectSetCookie(headers: Headers): string[] {
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function oauth1Header(
  method: string,
  fullUrl: string,
  options: {
    consumer: OauthConsumer;
    token?: { key: string; secret: string };
    bodyParams?: Record<string, string>;
  },
): string {
  const url = new URL(fullUrl);
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: options.consumer.consumer_key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };
  if (options.token) oauthParams.oauth_token = options.token.key;

  const allParams: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => allParams.push([key, value]));
  for (const [key, value] of Object.entries(oauthParams)) {
    allParams.push([key, value]);
  }
  for (const [key, value] of Object.entries(options.bodyParams ?? {})) {
    allParams.push([key, value]);
  }

  const normalizedParams = allParams
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as [string, string])
    .sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const signatureBase = [
    method.toUpperCase(),
    rfc3986(baseUrl),
    rfc3986(normalizedParams),
  ].join("&");
  const signingKey = `${rfc3986(options.consumer.consumer_secret)}&${rfc3986(options.token?.secret ?? "")}`;
  const signature = createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.entries(headerParams)
      .map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`)
      .join(", ")
  );
}

function ssoPageHeaders(): Record<string, string> {
  return {
    "User-Agent": SSO_PAGE_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
  };
}

async function ssoFetch(
  jar: CookieJar,
  method: string,
  url: string,
  init: {
    headers: Record<string, string>;
    body?: string;
    redirect?: RequestRedirect;
  },
): Promise<Response> {
  const cookie = jar.header();
  const headers = cookie ? { ...init.headers, Cookie: cookie } : init.headers;
  const response = await fetch(url, {
    method,
    headers,
    body: init.body,
    redirect: init.redirect ?? "follow",
  });
  jar.capture(response);
  return response;
}

async function parseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    if (!response.ok) {
      throw new GarminAuthError(
        `Garmin returned HTTP ${response.status} with an empty body. SSO may be rate-limiting this server IP.`,
      );
    }
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new GarminAuthError(
      `Garmin returned a non-JSON login response (HTTP ${response.status}). Try again later from this network.`,
    );
  }
}

function responseStatusType(json: Record<string, unknown>): string | undefined {
  const status = json.responseStatus as Record<string, unknown> | undefined;
  return typeof status?.type === "string" ? status.type : undefined;
}

function asStatusRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function describeLoginFailure(
  json: Record<string, unknown>,
  httpStatus: number,
): string {
  const status = asStatusRecord(json.responseStatus);
  const type =
    typeof status?.type === "string" ? status.type.trim().toUpperCase() : "";
  const message = typeof status?.message === "string" ? status.message.trim() : "";
  const reason =
    typeof json.responseReason === "string" ? json.responseReason.trim() : "";
  const blob = `${type} ${message} ${reason}`.toLowerCase();

  if (httpStatus === 429 || blob.includes("429") || blob.includes("too many")) {
    return "Garmin rate-limited this login (HTTP 429). Stop retrying for a while; repeats make the block last longer.";
  }
  if (type === "CAPTCHA_REQUIRED" || blob.includes("captcha")) {
    return "Garmin asked for a captcha, so this host is being treated as a bot. That is not a password error.";
  }
  if (
    /invalid|incorrect|locked|credentials/.test(blob) &&
    !/captcha|unknown/.test(blob)
  ) {
    return "Garmin rejected the email or password.";
  }
  if (!type || type === "UNKNOWN") {
    return blockedHostMessage();
  }
  return message ? `${type}: ${message}` : type;
}

function blockedHostMessage(): string {
  return (
    "Garmin blocked this login (SSO returned UNKNOWN). " +
    "That is almost never a bad password — this IP looks automated to Garmin. " +
    "Stop retrying for a few minutes. From this Mac, run: npm run garmin:login -- --push"
  );
}

function logSsoPayload(
  label: string,
  httpStatus: number,
  json: Record<string, unknown>,
): void {
  const status = asStatusRecord(json.responseStatus);
  console.error("[garmin/sso]", label, {
    httpStatus,
    keys: Object.keys(json),
    type: typeof status?.type === "string" ? status.type : null,
    http: typeof status?.httpStatus === "string" ? status.httpStatus : null,
    reason:
      typeof json.responseReason === "string" ? json.responseReason : null,
    captchaAlreadyPassed: json.captchaAlreadyPassed ?? null,
    authType: typeof json.authType === "string" ? json.authType : null,
  });
}

function requireTicket(json: Record<string, unknown>): string {
  const ticket = json.serviceTicketId;
  if (typeof ticket !== "string" || !ticket) {
    throw new GarminAuthError(
      "Garmin login succeeded but no service ticket was returned.",
    );
  }
  return ticket;
}

function ssoHost(): string {
  return `https://sso.${DOMAIN}`;
}

function connectApiHost(): string {
  return `https://connectapi.${DOMAIN}`;
}

function serviceUrl(): string {
  return `https://mobile.integration.${DOMAIN}/gcm/android`;
}

function loginQuery(): string {
  return new URLSearchParams({
    clientId: CLIENT_ID,
    locale: "en-US",
    service: serviceUrl(),
  }).toString();
}

async function fetchConsumer(): Promise<OauthConsumer> {
  if (consumerCache) return consumerCache;
  const resp = await fetch(OAUTH_CONSUMER_URL);
  if (!resp.ok) {
    throw new GarminAuthError(
      `Could not fetch Garmin OAuth consumer (HTTP ${resp.status}).`,
    );
  }
  const json = (await resp.json()) as Record<string, unknown>;
  if (
    typeof json.consumer_key !== "string" ||
    typeof json.consumer_secret !== "string"
  ) {
    throw new GarminAuthError("Garmin OAuth consumer payload was malformed.");
  }
  consumerCache = {
    consumer_key: json.consumer_key,
    consumer_secret: json.consumer_secret,
  };
  return consumerCache;
}

function withExpiresAt(oauth2: Oauth2Token): Oauth2Token {
  const expiresIn =
    typeof oauth2.expires_in === "number" && oauth2.expires_in > 0
      ? oauth2.expires_in
      : 3600;
  return {
    ...oauth2,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
  };
}

async function getOauth1Token(
  jar: CookieJar,
  consumer: OauthConsumer,
  ticket: string,
  loginUrl: string = serviceUrl(),
): Promise<Oauth1Token> {
  const url =
    `${connectApiHost()}/oauth-service/oauth/preauthorized` +
    `?ticket=${encodeURIComponent(ticket)}` +
    `&login-url=${encodeURIComponent(loginUrl)}` +
    `&accepts-mfa-tokens=true`;
  const auth = oauth1Header("GET", url, { consumer });
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": OAUTH_USER_AGENT,
      Authorization: auth,
      Cookie: jar.header(),
    },
  });
  if (!resp.ok) {
    throw new GarminAuthError(
      `Garmin OAuth1 exchange failed (HTTP ${resp.status}). Retry login.`,
    );
  }
  const parsed = Object.fromEntries(
    new URLSearchParams(await resp.text()).entries(),
  );
  if (!parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new GarminAuthError(
      "Garmin OAuth1 response was missing oauth_token.",
    );
  }
  return {
    oauth_token: parsed.oauth_token,
    oauth_token_secret: parsed.oauth_token_secret,
    ...(parsed.mfa_token ? { mfa_token: parsed.mfa_token } : {}),
  };
}

async function exchangeOauth2(
  jar: CookieJar | null,
  consumer: OauthConsumer,
  oauth1: Oauth1Token,
): Promise<Oauth2Token> {
  const url = `${connectApiHost()}/oauth-service/oauth/exchange/user/2.0`;
  const form: Record<string, string> = {
    audience: "GARMIN_CONNECT_MOBILE_ANDROID_DI",
  };
  if (oauth1.mfa_token) form.mfa_token = oauth1.mfa_token;
  const body = new URLSearchParams(form).toString();
  const auth = oauth1Header("POST", url, {
    consumer,
    token: { key: oauth1.oauth_token, secret: oauth1.oauth_token_secret },
    bodyParams: form,
  });
  const headers: Record<string, string> = {
    "User-Agent": OAUTH_USER_AGENT,
    Authorization: auth,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (jar) headers.Cookie = jar.header();
  const resp = await fetch(url, { method: "POST", headers, body });
  if (!resp.ok) {
    throw new GarminAuthError(
      `Garmin OAuth2 exchange failed (HTTP ${resp.status}).`,
    );
  }
  const json = (await resp.json()) as Record<string, unknown>;
  if (
    typeof json.access_token !== "string" ||
    typeof json.refresh_token !== "string"
  ) {
    throw new GarminAuthError(
      "Garmin OAuth2 exchange was missing access_token.",
    );
  }
  return withExpiresAt({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in:
      typeof json.expires_in === "number" ? json.expires_in : undefined,
    refresh_token_expires_in:
      typeof json.refresh_token_expires_in === "number"
        ? json.refresh_token_expires_in
        : undefined,
    token_type:
      typeof json.token_type === "string" ? json.token_type : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
  });
}

async function ticketsToTokens(
  jar: CookieJar,
  ticket: string,
  loginUrl: string = serviceUrl(),
): Promise<GarminStoredTokens> {
  const consumer = await fetchConsumer();
  const oauth1 = await getOauth1Token(jar, consumer, ticket, loginUrl);
  const oauth2 = await exchangeOauth2(jar, consumer, oauth1);
  return { oauth1, oauth2 };
}

async function finishLogin(
  jar: CookieJar,
  ticket: string,
  loginUrl: string = serviceUrl(),
): Promise<{ tokens: GarminStoredTokens; displayName: string | null }> {
  const tokens = await ticketsToTokens(jar, ticket, loginUrl);
  const api = new GarminApi(tokens);
  let displayName: string | null = null;
  try {
    displayName = (await api.getSocialIdentity()).displayName;
  } catch {
    displayName = null;
  }
  return { tokens: api.tokens, displayName };
}

function widgetEmbedUrl(): string {
  return `${ssoHost()}/sso/embed`;
}

function widgetSigninUrl(): string {
  const embed = widgetEmbedUrl();
  const params = new URLSearchParams({
    id: "gauth-widget",
    embedWidget: "true",
    gauthHost: embed,
    service: embed,
    source: embed,
    redirectAfterAccountLoginUrl: embed,
    redirectAfterAccountCreationUrl: embed,
  });
  return `${ssoHost()}/sso/signin?${params.toString()}`;
}

function widgetHeaders(referer?: string): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...(referer ? { Referer: referer } : {}),
  };
}

function extractCsrf(html: string): string | null {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/i);
  return match?.[1] ?? null;
}

function extractTicket(html: string): string | null {
  const match = html.match(/[?&]ticket=(ST-[^"&\s]+)/);
  return match?.[1] ?? null;
}

function extractTitle(html: string): string {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return (match?.[1] ?? "").trim();
}

function parseWidgetMfaVars(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /var\s+(customerGuid|mfaMethod|locale|clientId|codeSentTo)\s*=\s*"([^"]*)"\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    out[match[1]] = match[2];
  }
  return out;
}

async function loginGarminWidget(
  email: string,
  password: string,
): Promise<GarminLoginResult> {
  const jar = new CookieJar();
  const embed = widgetEmbedUrl();
  const signin = widgetSigninUrl();
  const headers = widgetHeaders();

  const embedResp = await ssoFetch(
    jar,
    "GET",
    `${embed}?id=gauth-widget&embedWidget=true&gauthHost=${encodeURIComponent(`${ssoHost()}/sso`)}`,
    { headers },
  );
  if (embedResp.status === 429) {
    throw new GarminAuthError(
      "Garmin rate-limited the widget login (HTTP 429). Wait before retrying.",
    );
  }

  const signinGet = await ssoFetch(jar, "GET", signin, {
    headers: widgetHeaders(embed),
  });
  const signinHtml = await signinGet.text();
  const csrf = extractCsrf(signinHtml);
  if (!csrf) {
    throw new GarminAuthError(
      "Garmin blocked the alternate login page (no CSRF token). This is usually a Cloudflare check on this host, not a bad password.",
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 2500));

  const post = await ssoFetch(jar, "POST", signin, {
    headers: {
      ...widgetHeaders(signin),
      Origin: ssoHost(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      username: email,
      password,
      embed: "true",
      _csrf: csrf,
    }).toString(),
  });
  const html = await post.text();
  const title = extractTitle(html);
  const titleLower = title.toLowerCase();
  if (post.status === 429 || titleLower.includes("too many")) {
    throw new GarminAuthError(
      "Garmin rate-limited the widget login. Wait before retrying.",
    );
  }
  if (/invalid|incorrect|locked/.test(titleLower)) {
    throw new GarminAuthError("Garmin rejected the email or password.");
  }

  const mfaVars = parseWidgetMfaVars(html);
  const mfaMethod = mfaVars.mfaMethod || "email";
  const looksLikeMfa =
    titleLower.includes("mfa") ||
    (titleLower.includes("authentication application") && Boolean(mfaVars.mfaMethod));
  if (looksLikeMfa) {
    return {
      ok: false,
      mfaRequired: true,
      pending: {
        cookies: jar.toRecord(),
        mfaMethod,
        createdAt: Date.now(),
        flow: "widget",
        csrf: extractCsrf(html) ?? csrf,
        referer: signin,
      },
    };
  }

  const ticket = extractTicket(html);
  if (!ticket) {
    throw new GarminAuthError(
      `Garmin widget login did not return a ticket (page “${title || "unknown"}”).`,
    );
  }
  const { tokens, displayName } = await finishLogin(jar, ticket, embed);
  return { ok: true, tokens, displayName };
}

export async function loginGarmin(
  email: string,
  password: string,
): Promise<GarminLoginResult> {
  const jar = new CookieJar();
  const host = ssoHost();

  await ssoFetch(
    jar,
    "GET",
    `${host}/sso/mobile/sso/en/sign-in?clientId=${CLIENT_ID}`,
    { headers: { ...ssoPageHeaders(), "Sec-Fetch-Site": "none" } },
  );

  const loginResp = await ssoFetch(
    jar,
    "POST",
    `${host}/sso/mobile/api/login?${loginQuery()}`,
    {
      headers: {
        ...ssoPageHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: host,
        Referer: `${host}/sso/mobile/sso/en/sign-in?clientId=${CLIENT_ID}`,
      },
      body: JSON.stringify({
        username: email,
        password,
        rememberMe: false,
        captchaToken: "",
      }),
    },
  );
  const loginJson = await parseJson(loginResp);
  const loginType = responseStatusType(loginJson);

  if (loginType === SSO_SUCCESSFUL) {
    const ticket = requireTicket(loginJson);
    const { tokens, displayName } = await finishLogin(jar, ticket);
    return { ok: true, tokens, displayName };
  }

  if (loginType === SSO_MFA_REQUIRED) {
    const mfaInfo =
      (loginJson.customerMfaInfo as Record<string, unknown> | undefined) ?? {};
    const mfaMethod =
      typeof mfaInfo.mfaLastMethodUsed === "string"
        ? mfaInfo.mfaLastMethodUsed
        : "email";
    return {
      ok: false,
      mfaRequired: true,
      pending: {
        cookies: jar.toRecord(),
        mfaMethod,
        createdAt: Date.now(),
        flow: "mobile",
      },
    };
  }

  logSsoPayload("mobile-login", loginResp.status, loginJson);
  const blocked =
    !loginType ||
    loginType === "UNKNOWN" ||
    loginType === "CAPTCHA_REQUIRED";
  if (blocked) {
    try {
      return await loginGarminWidget(email, password);
    } catch (err) {
      if (
        err instanceof GarminAuthError &&
        err.message.includes("rejected the email or password")
      ) {
        throw err;
      }
      console.error(
        "[garmin/sso] widget fallback failed",
        err instanceof Error ? err.message : err,
      );
      throw new GarminAuthError(blockedHostMessage());
    }
  }

  throw new GarminAuthError(describeLoginFailure(loginJson, loginResp.status));
}

export function isPendingMfaFresh(pending: GarminPendingMfa): boolean {
  return Date.now() - pending.createdAt < MFA_TTL_MS;
}

export async function verifyGarminMfa(
  pending: GarminPendingMfa,
  code: string,
): Promise<{ tokens: GarminStoredTokens; displayName: string | null }> {
  if (!isPendingMfaFresh(pending)) {
    throw new GarminAuthError("Garmin MFA session expired. Connect again.");
  }
  const trimmed = code.trim();
  if (!trimmed) {
    throw new GarminAuthError("Garmin MFA code was empty.");
  }
  if (pending.flow === "widget") {
    return verifyGarminWidgetMfa(pending, trimmed);
  }
  const jar = CookieJar.fromRecord(pending.cookies);
  const mfaResp = await ssoFetch(
    jar,
    "POST",
    `${ssoHost()}/sso/mobile/api/mfa/verifyCode?${loginQuery()}`,
    {
      headers: {
        ...ssoPageHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        mfaMethod: pending.mfaMethod,
        mfaVerificationCode: trimmed,
        rememberMyBrowser: false,
        reconsentList: [],
        mfaSetup: false,
      }),
    },
  );
  const mfaJson = await parseJson(mfaResp);
  if (responseStatusType(mfaJson) !== SSO_SUCCESSFUL) {
    throw new GarminAuthError(
      `Garmin MFA verification failed: ${describeLoginFailure(mfaJson, mfaResp.status)}`,
    );
  }
  const ticket = requireTicket(mfaJson);
  return finishLogin(jar, ticket);
}

async function verifyGarminWidgetMfa(
  pending: GarminPendingMfa,
  code: string,
): Promise<{ tokens: GarminStoredTokens; displayName: string | null }> {
  if (!pending.csrf) {
    throw new GarminAuthError("Garmin MFA session was missing CSRF. Connect again.");
  }
  const jar = CookieJar.fromRecord(pending.cookies);
  const signin = widgetSigninUrl();
  const post = await ssoFetch(
    jar,
    "POST",
    `${ssoHost()}/sso/verifyMFA/loginEnterMfaCode?${new URL(signin).searchParams.toString()}`,
    {
      headers: {
        ...widgetHeaders(pending.referer || signin),
        Origin: ssoHost(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "mfa-code": code,
        embed: "true",
        _csrf: pending.csrf,
        fromPage: "setupEnterMfaCode",
      }).toString(),
    },
  );
  const html = await post.text();
  const title = extractTitle(html);
  if (post.status === 429) {
    throw new GarminAuthError("Garmin rate-limited MFA. Wait before retrying.");
  }
  if (title.toLowerCase() !== "success") {
    const ticketEarly = extractTicket(html);
    if (!ticketEarly) {
      throw new GarminAuthError(
        `Garmin MFA verification failed (${title || "unexpected page"}).`,
      );
    }
  }
  const ticket = extractTicket(html);
  if (!ticket) {
    throw new GarminAuthError("Garmin MFA succeeded but no service ticket was returned.");
  }
  return finishLogin(jar, ticket, widgetEmbedUrl());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function finitePositive(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function finiteNonNeg(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function parseOvernightHrv(payload: unknown): number | null {
  const root = asRecord(payload);
  const summary = asRecord(root?.hrvSummary) ?? root;
  return finitePositive(summary?.lastNightAvg);
}

export function parseSleepScore(payload: unknown): number | null {
  const dto = asRecord(asRecord(payload)?.dailySleepDTO) ?? asRecord(payload);
  if (!dto) return null;
  const overall = asRecord(asRecord(dto.sleepScores)?.overall);
  return (
    finitePositive(overall?.value) ??
    finitePositive(dto.sleepScore) ??
    finitePositive(dto.overallSleepScore)
  );
}

export function parseSleepHours(payload: unknown): number | null {
  const dto = asRecord(asRecord(payload)?.dailySleepDTO) ?? asRecord(payload);
  const sec = finitePositive(dto?.sleepTimeSeconds);
  if (sec == null) return null;
  return Math.round((sec / 3600) * 10) / 10;
}

export function parseRestingHr(payload: unknown): number | null {
  const root = asRecord(payload);
  return (
    finitePositive(root?.restingHeartRate) ??
    finitePositive(asRecord(root?.heartRateValues)?.restingHeartRate)
  );
}

export function parseDailyStress(payload: unknown): number | null {
  const root = asRecord(payload);
  return (
    finiteNonNeg(root?.avgStressLevel) ??
    finiteNonNeg(root?.overallStressLevel)
  );
}

export function parseUserProfilePk(payload: unknown): number | null {
  const profile = asRecord(payload);
  if (!profile) return null;
  const records = [
    profile,
    asRecord(profile.userProfile),
    asRecord(profile.userData),
  ].filter((row): row is Record<string, unknown> => row != null);
  for (const rec of records) {
    for (const key of ["profileId", "userProfilePk", "userProfileId", "id"]) {
      const value = rec[key];
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0 &&
        value < 1e12
      ) {
        return Math.trunc(value);
      }
      if (typeof value === "string" && /^\d+$/.test(value)) {
        return Number(value);
      }
    }
  }
  return null;
}

function parseDisplayName(payload: unknown): string | null {
  const profile = asRecord(payload);
  if (!profile) return null;
  return (
    (typeof profile.displayName === "string" && profile.displayName) ||
    (typeof profile.fullName === "string" && profile.fullName) ||
    (typeof profile.userName === "string" && profile.userName) ||
    null
  );
}

const WATCH_NAME_RE =
  /forerunner|fenix|epix|instinct|venu|vivoactive|lily|approach s|enduro|tactix|marq|\bd2\b|fr\d|watch/i;
const NON_WATCH_NAME_RE =
  /index|scale|radar|hrm|chest|heart rate monitor|edge |dash cam|inreach|variac|cycling computer|bike sensor/i;

function collectDeviceRows(payload: unknown): unknown[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload;
  const rec = asRecord(payload);
  if (!rec) return [];
  for (const key of [
    "deviceList",
    "devices",
    "userDevices",
    "registeredDevices",
  ]) {
    const value = rec[key];
    if (Array.isArray(value)) return value;
  }
  const nested = asRecord(rec.userDevice) ?? asRecord(rec.device);
  if (nested) return [nested];
  if (deviceDisplayName(rec)) return [rec];
  return [];
}

function deviceDisplayName(rec: Record<string, unknown>): string {
  for (const key of [
    "productDisplayName",
    "lastUsedDeviceName",
    "displayName",
    "deviceName",
    "productName",
    "model",
  ]) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseDeviceLastUsed(rec: Record<string, unknown>): number | null {
  for (const key of [
    "lastUsedDeviceDownloadTime",
    "lastUsedTimestamp",
    "lastUsedTime",
    "lastUsedDate",
    "lastUsed",
  ]) {
    const value = rec[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === "string" && value.trim()) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return null;
}

export function parseDeviceList(payload: unknown): GarminDevice[] {
  const out: GarminDevice[] = [];
  for (const row of collectDeviceRows(payload)) {
    const rec = asRecord(row);
    if (!rec) continue;
    const displayName = deviceDisplayName(rec);
    if (!displayName) continue;
    const watchLike =
      WATCH_NAME_RE.test(displayName) && !NON_WATCH_NAME_RE.test(displayName);
    out.push({
      displayName,
      lastUsedAt: parseDeviceLastUsed(rec),
      primary: rec.primaryUser === true || rec.primary === true,
      watchLike,
    });
  }
  return out;
}

export function pickPrimaryWatchName(devices: GarminDevice[]): string | null {
  if (devices.length === 0) return null;
  const watches = devices.filter((d) => d.watchLike);
  const pool = watches.length > 0 ? watches : devices;
  const ranked = [...pool].sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
  });
  return ranked[0]?.displayName ?? null;
}

function parseGearDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function parseGearList(payload: unknown): GarminGearItem[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.gearList)
      ? (asRecord(payload)?.gearList as unknown[])
      : [];
  const out: GarminGearItem[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec) continue;
    const uuid = typeof rec.uuid === "string" ? rec.uuid.trim() : "";
    if (!uuid) continue;
    const dateEnd = parseGearDate(rec.dateEnd);
    const statusRaw =
      (typeof rec.gearStatusName === "string" && rec.gearStatusName) ||
      (typeof rec.status === "string" && rec.status) ||
      "";
    const status = statusRaw.toLowerCase();
    const retiredFlag = rec.retired === true || status === "retired";
    out.push({
      uuid,
      displayName:
        (typeof rec.displayName === "string" && rec.displayName) ||
        (typeof rec.customMakeModel === "string" && rec.customMakeModel) ||
        uuid,
      customMakeModel:
        typeof rec.customMakeModel === "string" ? rec.customMakeModel : null,
      gearMakeName:
        typeof rec.gearMakeName === "string" ? rec.gearMakeName : null,
      gearModelName:
        typeof rec.gearModelName === "string" ? rec.gearModelName : null,
      gearTypeName:
        typeof rec.gearTypeName === "string" ? rec.gearTypeName : null,
      dateBegin: parseGearDate(rec.dateBegin),
      dateEnd,
      retired: retiredFlag || dateEnd != null,
      raw: rec,
    });
  }
  return out;
}

export function parseGearStatsDistance(payload: unknown): number | null {
  const root = asRecord(payload);
  if (!root) return null;
  return (
    finiteNonNeg(root.totalDistance) ??
    finiteNonNeg(root.totalDistanceMeters) ??
    finiteNonNeg(root.distanceInMeters) ??
    finiteNonNeg(root.distance)
  );
}

export class GarminApi {
  tokens: GarminStoredTokens;
  private onTokens?: (tokens: GarminStoredTokens) => Promise<void>;

  constructor(
    tokens: GarminStoredTokens,
    onTokens?: (tokens: GarminStoredTokens) => Promise<void>,
  ) {
    this.tokens = tokens;
    this.onTokens = onTokens;
  }

  private async persist(): Promise<void> {
    if (this.onTokens) await this.onTokens(this.tokens);
  }

  async refreshOauth2(): Promise<void> {
    const consumer = await fetchConsumer();
    this.tokens = {
      ...this.tokens,
      oauth2: await exchangeOauth2(null, consumer, this.tokens.oauth1),
    };
    await this.persist();
  }

  private async ensureFresh(): Promise<void> {
    const expiresAt = this.tokens.oauth2.expires_at ?? 0;
    if (expiresAt < Math.floor(Date.now() / 1000) + 60) {
      await this.refreshOauth2();
    }
  }

  async getJson(path: string): Promise<unknown | null> {
    await this.ensureFresh();
    const url = path.startsWith("http") ? path : `${connectApiHost()}${path}`;
    const send = () =>
      fetch(url, {
        headers: {
          Authorization: `Bearer ${this.tokens.oauth2.access_token}`,
          "User-Agent": OAUTH_USER_AGENT,
          Accept: "application/json",
          NK: "NT",
          "DI-Backend": "connectapi." + DOMAIN,
        },
      });

    let resp = await send();
    if (resp.status === 401) {
      await this.refreshOauth2();
      resp = await send();
    }
    if (resp.status === 404 || resp.status === 204) return null;
    if (!resp.ok) {
      throw new Error(`Garmin GET ${path} failed (HTTP ${resp.status})`);
    }
    const text = await resp.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  async getSocialIdentity(): Promise<GarminSocialIdentity> {
    const profile = await this.getJson("/userprofile-service/socialProfile");
    return {
      displayName: parseDisplayName(profile),
      userProfilePk: parseUserProfilePk(profile),
    };
  }

  async getDisplayName(): Promise<string | null> {
    return (await this.getSocialIdentity()).displayName;
  }

  async getGear(
    userProfilePk: number,
    availableDate?: string,
  ): Promise<GarminGearItem[] | null> {
    const params = new URLSearchParams({
      userProfilePk: String(userProfilePk),
    });
    if (availableDate) params.set("availableGearDate", availableDate);
    try {
      const payload = await this.getJson(
        `/gear-service/gear/filterGear?${params.toString()}`,
      );
      if (payload == null) return availableDate ? [] : null;
      return parseGearList(payload);
    } catch (err) {
      if (availableDate) return null;
      throw err;
    }
  }

  async getDevices(): Promise<GarminDevice[]> {
    const paths = [
      "/device-service/deviceregistration/devices",
      "/device-service/deviceservice/mylastused",
    ];
    for (const path of paths) {
      try {
        const payload = await this.getJson(path);
        const list = parseDeviceList(payload);
        if (list.length > 0) return list;
      } catch (err) {
        console.error(
          "[garmin] devices",
          path,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return [];
  }

  async getGearStatsDistance(uuid: string): Promise<number | null> {
    const payload = await this.getJson(
      `/gear-service/gear/stats/${encodeURIComponent(uuid)}`,
    );
    return parseGearStatsDistance(payload);
  }

  async getDayWellness(
    date: string,
    displayName?: string | null,
  ): Promise<GarminDayWellness> {
    const sleepPath = displayName
      ? `/wellness-service/wellness/dailySleepData/${encodeURIComponent(displayName)}?date=${date}&nonSleepBufferMinutes=60`
      : `/wellness-service/wellness/dailySleepData?date=${date}&nonSleepBufferMinutes=60`;
    const hrPath = displayName
      ? `/wellness-service/wellness/dailyHeartRate/${encodeURIComponent(displayName)}?date=${date}`
      : `/wellness-service/wellness/dailyHeartRate?date=${date}`;

    const [sleep, hrv, hr, stress] = await Promise.all([
      this.getJson(sleepPath),
      this.getJson(`/hrv-service/hrv/${date}`),
      this.getJson(hrPath),
      this.getJson(`/wellness-service/wellness/dailyStress/${date}`),
    ]);

    return {
      overnightHrv: parseOvernightHrv(hrv),
      sleepScore: parseSleepScore(sleep),
      sleepHours: parseSleepHours(sleep),
      restingHr: parseRestingHr(hr),
      stress: parseDailyStress(stress),
    };
  }
}
