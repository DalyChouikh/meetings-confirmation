import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import {
  GMAIL_CONNECT_CALLBACK_PATH,
  GMAIL_CONNECT_COOKIE,
  GMAIL_CONNECT_COOKIE_PATH,
  GMAIL_SEND_SCOPE,
} from "@/config/gmail";
import { publicEnv } from "@/config/public-env";
import { requireSecret } from "@/config/secrets";
import { loginPathFor } from "@/lib/auth-redirect";
import { logger } from "@/lib/logger";
import { senderSettingsPath, withQuery } from "@/lib/with-query";
import {
  connectionAssociatedData,
  parseEncryptionKey,
  sealSecret,
} from "@/server/crypto/secret-box";
import { tokensEqual } from "@/server/crypto/tokens";
import {
  decodeConnectCookie,
  exchangeGoogleCode,
  revokeGoogleToken,
  type GoogleConnectGrant,
} from "@/server/google/google-oauth";
import { requireUser } from "@/server/http/require-user";
import {
  saveGoogleConnection,
  setWorkspaceSender,
} from "@/server/queries/sender";
import { getWorkspaceBySlug } from "@/server/queries/workspaces";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import type { GmailConnectError } from "@/shared/api/sender";

function redirectClearingCookie(
  path: string,
  request: NextRequest,
): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.cookies.delete({
    name: GMAIL_CONNECT_COOKIE,
    path: GMAIL_CONNECT_COOKIE_PATH,
  });
  return response;
}

/** Finishes "Connect Gmail sending": verify state, exchange, check scopes, seal, save, set sender. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const stored = decodeConnectCookie(
    request.cookies.get(GMAIL_CONNECT_COOKIE)?.value,
  );
  if (!stored) {
    return redirectClearingCookie("/welcome", request);
  }
  const returnTo = stored.next ?? senderSettingsPath(stored.workspaceSlug);
  const fail = (reason: GmailConnectError) =>
    redirectClearingCookie(withQuery(returnTo, "gmail_error", reason), request);
  const params = request.nextUrl.searchParams;
  if (params.get("error") === "access_denied") {
    return fail("cancelled");
  }
  const code = params.get("code");
  const state = params.get("state");
  if (
    !code ||
    !state ||
    params.get("error") ||
    !tokensEqual(state, stored.state)
  ) {
    return fail("failed");
  }
  if (
    !publicEnv.NEXT_PUBLIC_GMAIL_CONNECT_ENABLED ||
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET
  ) {
    return fail("unavailable");
  }
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return redirectClearingCookie(loginPathFor(returnTo), request);
  }
  const workspace = await getWorkspaceBySlug(
    supabase,
    user.id,
    stored.workspaceSlug,
  );
  if (!workspace || workspace.myRole !== "owner") {
    return fail("owner_only");
  }
  let grant: GoogleConnectGrant;
  try {
    grant = await exchangeGoogleCode({
      code,
      verifier: stored.verifier,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${publicEnv.NEXT_PUBLIC_APP_URL}${GMAIL_CONNECT_CALLBACK_PATH}`,
    });
  } catch (error) {
    logger.error({ err: error }, "Gmail connect code exchange failed");
    return fail("failed");
  }
  if (!grant.scopes.includes(GMAIL_SEND_SCOPE)) {
    if (grant.refreshToken) {
      await revokeGoogleToken(grant.refreshToken);
    }
    return fail("scope_denied");
  }
  if (!grant.refreshToken) {
    return fail("no_refresh_token");
  }
  if (!grant.claims.emailVerified) {
    await revokeGoogleToken(grant.refreshToken);
    return fail("failed");
  }
  const key = parseEncryptionKey(
    requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", env),
  );
  const saved = await saveGoogleConnection(createSupabaseAdminClient(), {
    userId: user.id,
    googleSub: grant.claims.sub,
    googleEmail: grant.claims.email,
    scopes: grant.scopes,
    tokenEncrypted: sealSecret(
      grant.refreshToken,
      key,
      connectionAssociatedData(user.id, grant.claims.sub),
    ),
  });
  if (saved.error || !saved.data) {
    logger.error({ err: saved.error }, "saving the Gmail connection failed");
    return fail("failed");
  }
  const sender = await setWorkspaceSender(supabase, workspace.id, saved.data);
  if (sender.error) {
    logger.error({ err: sender.error }, "setting the workspace sender failed");
    return fail("failed");
  }
  return redirectClearingCookie(
    withQuery(returnTo, "gmail", "connected"),
    request,
  );
}
