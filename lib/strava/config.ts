/**
 * Strava env + OAuth helpers.
 * Create an API app at https://www.strava.com/settings/api
 */

export function getStravaConfig() {
  const clientId = process.env.STRAVA_CLIENT_ID?.trim();
  const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.STRAVA_REDIRECT_URI?.trim() ||
    "http://localhost:3000/api/strava/callback";

  return { clientId, clientSecret, redirectUri };
}

export function assertStravaConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const { clientId, clientSecret, redirectUri } = getStravaConfig();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET. Add them to .env.local (see README).",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildStravaAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = assertStravaConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all,profile:read_all",
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}
