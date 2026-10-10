import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/config/env";
import { requireSecret } from "@/config/secrets";
import { logger } from "@/lib/logger";
import {
  connectionAssociatedData,
  openSecret,
  parseEncryptionKey,
} from "@/server/crypto/secret-box";
import { revokeGoogleToken } from "@/server/google/google-oauth";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { disconnectGoogleConnection } from "@/server/queries/sender";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/**
 * Disconnects one of my Gmail connections: deletes it (workspaces using it pause, spec §7.15) and
 * revokes the token at Google on a best-effort basis.
 */
export async function DELETE(
  request: NextRequest | Request,
  ctx: RouteContext<"/api/integrations/google/connections/[id]">,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { id } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return apiError("unauthenticated");
  }
  const { data, error } = await disconnectGoogleConnection(supabase, id);
  if (error || !data) {
    return error ? fromDatabaseError(error) : apiError("not_found");
  }
  try {
    const env = getServerEnv();
    const key = parseEncryptionKey(
      requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", env),
    );
    const token = openSecret(
      data.tokenEncrypted,
      key,
      connectionAssociatedData(user.id, data.googleSub),
    );
    if (!(await revokeGoogleToken(token))) {
      logger.warn("Google did not confirm token revocation");
    }
  } catch (revokeError) {
    logger.warn({ err: revokeError }, "could not open the token to revoke it");
  }
  return ok();
}
