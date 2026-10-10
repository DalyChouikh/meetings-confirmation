import "server-only";
import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/config/env";
import { GMAIL_SEND_TIMEOUT_MS } from "@/config/gmail";
import { publicEnv } from "@/config/public-env";
import { requireSecret } from "@/config/secrets";
import { renderOwnerAlertEmail } from "@/emails/owner-alert-email";
import { deriveInviteeToken } from "@/server/crypto/invitee-token";
import {
  connectionAssociatedData,
  openSecret,
  parseEncryptionKey,
} from "@/server/crypto/secret-box";
import { createSystemMailer } from "@/server/email/system-mailer";
import { sendGmailMessage } from "@/server/gmail/gmail-client";
import { refreshGoogleAccessToken } from "@/server/google/google-oauth";
import { createDispatchStore } from "@/server/queries/dispatch";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { DispatchDeps } from "./run-dispatch";

/**
 * Real dependencies for `runDispatch`.
 * @throws Error naming the first missing secret (sending cannot work without it)
 */
export function createDispatchDeps(): DispatchDeps {
  const env = getServerEnv();
  const key = parseEncryptionKey(
    requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", env),
  );
  const inviteSecret = requireSecret("INVITE_TOKEN_SECRET", env);
  const clientId = requireSecret("GOOGLE_CLIENT_ID", env);
  const clientSecret = requireSecret("GOOGLE_CLIENT_SECRET", env);
  const mailer = createSystemMailer();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;
  return {
    store: createDispatchStore(createSupabaseAdminClient()),
    gmail: (input) =>
      sendGmailMessage({
        ...input,
        baseUrl: env.GMAIL_API_BASE_URL,
        timeoutMs: GMAIL_SEND_TIMEOUT_MS,
      }),
    refresh: (refreshToken) =>
      refreshGoogleAccessToken({
        refreshToken,
        clientId,
        clientSecret,
        tokenUrl: env.GOOGLE_OAUTH_TOKEN_URL,
      }),
    openToken: (sealed, userId, googleSub) =>
      openSecret(sealed, key, connectionAssociatedData(userId, googleSub)),
    tokenFor: (inviteeId) => deriveInviteeToken(inviteeId, inviteSecret),
    appUrl,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    alertBroken: async (alert) => {
      for (const target of alert) {
        const content = await renderOwnerAlertEmail({
          kind: "senderBroken",
          workspaceName: target.workspaceName,
          settingsUrl: `${appUrl}/w/${target.workspaceSlug}/settings#sending`,
        });
        await mailer.send({ to: target.email, ...content });
      }
    },
    newRunId: () => randomUUID(),
  };
}
