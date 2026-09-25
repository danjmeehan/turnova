import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  GarminPendingMfa,
  GarminStoredTokens,
  Oauth1Token,
  Oauth2Token,
} from "@/lib/garmin/client";

const TOKEN_ID = "default";

export type GarminTokenStatus = {
  connected: boolean;
  displayName: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  mfaPending: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function parseOauth1(value: unknown): Oauth1Token | null {
  const row = asRecord(value);
  if (
    !row ||
    typeof row.oauth_token !== "string" ||
    typeof row.oauth_token_secret !== "string"
  ) {
    return null;
  }
  return {
    oauth_token: row.oauth_token,
    oauth_token_secret: row.oauth_token_secret,
    ...(typeof row.mfa_token === "string" ? { mfa_token: row.mfa_token } : {}),
  };
}

function parseOauth2(value: unknown): Oauth2Token | null {
  const row = asRecord(value);
  if (
    !row ||
    typeof row.access_token !== "string" ||
    typeof row.refresh_token !== "string"
  ) {
    return null;
  }
  return {
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expires_in: typeof row.expires_in === "number" ? row.expires_in : undefined,
    expires_at: typeof row.expires_at === "number" ? row.expires_at : undefined,
    refresh_token_expires_in:
      typeof row.refresh_token_expires_in === "number"
        ? row.refresh_token_expires_in
        : undefined,
    token_type: typeof row.token_type === "string" ? row.token_type : undefined,
    scope: typeof row.scope === "string" ? row.scope : undefined,
  };
}

function parsePendingMfa(value: unknown): GarminPendingMfa | null {
  const row = asRecord(value);
  const cookies = asRecord(row?.cookies);
  if (!row || !cookies || typeof row.mfaMethod !== "string") return null;
  const cookieRecord: Record<string, string> = {};
  for (const [k, v] of Object.entries(cookies)) {
    if (typeof v === "string") cookieRecord[k] = v;
  }
  return {
    cookies: cookieRecord,
    mfaMethod: row.mfaMethod,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
    ...(row.flow === "widget" || row.flow === "mobile"
      ? { flow: row.flow }
      : {}),
    ...(typeof row.csrf === "string" ? { csrf: row.csrf } : {}),
    ...(typeof row.referer === "string" ? { referer: row.referer } : {}),
  };
}

export async function getStoredGarminTokens(): Promise<GarminStoredTokens | null> {
  const row = await prisma.garminToken.findUnique({ where: { id: TOKEN_ID } });
  if (!row) return null;
  const oauth1 = parseOauth1(row.oauth1Json);
  const oauth2 = parseOauth2(row.oauth2Json);
  if (!oauth1 || !oauth2) return null;
  return { oauth1, oauth2 };
}

export async function getGarminPendingMfa(): Promise<GarminPendingMfa | null> {
  const row = await prisma.garminToken.findUnique({ where: { id: TOKEN_ID } });
  if (!row) return null;
  return parsePendingMfa(row.pendingMfaJson);
}

export async function saveGarminTokens(input: {
  tokens: GarminStoredTokens;
  displayName?: string | null;
  userProfilePk?: number | null;
  lastError?: string | null;
  clearPendingMfa?: boolean;
}): Promise<void> {
  const existing = await prisma.garminToken.findUnique({
    where: { id: TOKEN_ID },
  });
  const data = {
    oauth1Json: input.tokens.oauth1 as Prisma.InputJsonValue,
    oauth2Json: input.tokens.oauth2 as Prisma.InputJsonValue,
    displayName:
      input.displayName !== undefined
        ? input.displayName
        : (existing?.displayName ?? null),
    userProfilePk:
      input.userProfilePk !== undefined
        ? input.userProfilePk
        : (existing?.userProfilePk ?? null),
    lastError: input.lastError === undefined ? null : input.lastError,
    ...(input.clearPendingMfa
      ? { pendingMfaJson: Prisma.DbNull }
      : {}),
  };
  await prisma.garminToken.upsert({
    where: { id: TOKEN_ID },
    create: {
      id: TOKEN_ID,
      ...data,
      pendingMfaJson: Prisma.DbNull,
    },
    update: data,
  });
}

export async function saveGarminPendingMfa(
  pending: GarminPendingMfa,
): Promise<void> {
  await prisma.garminToken.upsert({
    where: { id: TOKEN_ID },
    create: {
      id: TOKEN_ID,
      oauth1Json: {},
      oauth2Json: {},
      pendingMfaJson: pending as Prisma.InputJsonValue,
      lastError: "mfa_required",
    },
    update: {
      pendingMfaJson: pending as Prisma.InputJsonValue,
      lastError: "mfa_required",
    },
  });
}

export async function setGarminSyncMeta(input: {
  lastSyncedAt?: Date | null;
  lastError?: string | null;
}): Promise<void> {
  const existing = await prisma.garminToken.findUnique({
    where: { id: TOKEN_ID },
  });
  if (!existing) return;
  await prisma.garminToken.update({
    where: { id: TOKEN_ID },
    data: {
      ...(input.lastSyncedAt !== undefined
        ? { lastSyncedAt: input.lastSyncedAt }
        : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
    },
  });
}

export async function deleteGarminToken(): Promise<void> {
  await prisma.garminToken.deleteMany({ where: { id: TOKEN_ID } });
}

export async function getGarminStatus(): Promise<GarminTokenStatus> {
  const row = await prisma.garminToken.findUnique({ where: { id: TOKEN_ID } });
  if (!row) {
    return {
      connected: false,
      displayName: null,
      lastSyncedAt: null,
      lastError: null,
      mfaPending: false,
    };
  }
  const oauth2 = parseOauth2(row.oauth2Json);
  const pending = parsePendingMfa(row.pendingMfaJson);
  return {
    connected: Boolean(oauth2?.access_token),
    displayName: row.displayName,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    mfaPending: Boolean(pending),
  };
}
