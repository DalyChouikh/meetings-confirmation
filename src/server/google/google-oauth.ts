import "server-only";
import { z } from "zod";
import {
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
} from "@/config/auth";
import { GMAIL_CONNECT_SCOPES, GOOGLE_REVOKE_ENDPOINT } from "@/config/gmail";
import { generateToken, sha256Base64Url } from "@/server/crypto/tokens";

const connectStateSchema = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  workspaceSlug: z.string().min(1),
  next: z.string().nullable(),
});

/** What the connect route remembers (httpOnly cookie) for the callback. */
export type GoogleConnectState = z.infer<typeof connectStateSchema>;

/**
 * Google's authorization URL for a Google connection (spec §9): `openid email gmail.send`,
 * offline access (refresh token), forced consent so a refresh token is always issued, incremental
 * scopes, and PKCE S256.
 */
export function createGoogleConnectAuthorization(input: {
  clientId: string;
  redirectUri: string;
  workspaceSlug: string;
  next: string | null;
}): { url: string; state: GoogleConnectState } {
  const state: GoogleConnectState = {
    state: generateToken(),
    verifier: generateToken(),
    workspaceSlug: input.workspaceSlug,
    next: input.next,
  };
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GMAIL_CONNECT_SCOPES.join(" "),
    state: state.state,
    code_challenge: sha256Base64Url(state.verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
  });
  return {
    url: `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`,
    state,
  };
}

/** Cookie-safe encoding (base64url JSON). */
export function encodeConnectCookie(state: GoogleConnectState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

/** Decodes the cookie; null when missing or malformed. */
export function decodeConnectCookie(
  value: string | undefined,
): GoogleConnectState | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = connectStateSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const idTokenClaimsSchema = z
  .object({
    sub: z.string().min(1),
    email: z.string().min(1),
    email_verified: z.boolean(),
  })
  .transform((claims) => ({
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    emailVerified: claims.email_verified,
  }));

/** The account an ID token names (`sub` is Google's stable account id). */
export type IdTokenClaims = z.output<typeof idTokenClaimsSchema>;

/**
 * Reads the claims of an ID token received **directly from Google's token endpoint** over HTTPS
 * with our client secret — Google's OpenID Connect guide says such a token can be trusted without
 * signature validation. Never use this for tokens from any other source.
 * @throws Error when the token is malformed or lacks `sub` / `email`
 */
export function decodeIdTokenClaims(idToken: string): IdTokenClaims {
  const payload = idToken.split(".")[1];
  if (!payload) {
    throw new Error("Malformed ID token");
  }
  return idTokenClaimsSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  );
}

const codeResponseSchema = z.object({
  id_token: z.string().min(1),
  scope: z.string(),
  refresh_token: z.string().min(1).optional(),
});

/** What a successful connect consent produced. */
export type GoogleConnectGrant = {
  refreshToken: string | null;
  scopes: string[];
  claims: IdTokenClaims;
};

/**
 * Exchanges the authorization code (PKCE verifier + client secret).
 * @throws Error naming only the HTTP status (Google's body may echo the code)
 */
export async function exchangeGoogleCode(
  input: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleConnectGrant> {
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `Google token exchange failed with HTTP ${response.status}`,
    );
  }
  const body = codeResponseSchema.parse(await response.json());
  return {
    refreshToken: body.refresh_token ?? null,
    scopes: body.scope.split(" ").filter(Boolean),
    claims: decodeIdTokenClaims(body.id_token),
  };
}

/** Result of turning a refresh token into an access token. */
export type RefreshResult =
  | { kind: "ok"; accessToken: string }
  | { kind: "invalid_grant" }
  | { kind: "error"; status: number };

const refreshResponseSchema = z.object({ access_token: z.string().min(1) });
const oauthErrorSchema = z.object({ error: z.string() });

/**
 * Refresh-token grant. `invalid_grant` means the connection is gone for good (revoked, password
 * changed, time-limited access ended); anything else is transient. Never throws.
 */
export async function refreshGoogleAccessToken(
  input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshResult> {
  try {
    const response = await fetchImpl(input.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
      }).toString(),
    });
    const body: object = await response.json().catch(() => ({}));
    if (response.ok) {
      const parsed = refreshResponseSchema.safeParse(body);
      return parsed.success
        ? { kind: "ok", accessToken: parsed.data.access_token }
        : { kind: "error", status: response.status };
    }
    const error = oauthErrorSchema.safeParse(body);
    return error.success && error.data.error === "invalid_grant"
      ? { kind: "invalid_grant" }
      : { kind: "error", status: response.status };
  } catch {
    return { kind: "error", status: 0 };
  }
}

/** Best-effort revocation on disconnect (spec §9). Never throws; false when Google did not confirm. */
export async function revokeGoogleToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}
