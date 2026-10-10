import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionAssociatedData,
  sealSecret,
} from "@/server/crypto/secret-box";
import { jsonRequest } from "@/test/workspace-context-mock";

const KEY = randomBytes(32);
const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  revoke: vi.fn(async () => true),
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    GOOGLE_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
    LOG_LEVEL: "info",
  }),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => ({ id: "user-1", email: null }),
}));
vi.mock("@/server/queries/sender", () => ({
  disconnectGoogleConnection: mocks.disconnect,
}));
vi.mock("@/server/google/google-oauth", () => ({
  revokeGoogleToken: mocks.revoke,
}));

const ID = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60";
const ctx = { params: Promise.resolve({ id: ID }) };
beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/integrations/google/connections/[id]", () => {
  it("deletes my connection and revokes its token at Google", async () => {
    mocks.disconnect.mockResolvedValueOnce({
      data: {
        tokenEncrypted: sealSecret(
          "1//rt",
          KEY,
          connectionAssociatedData("user-1", "g-1"),
        ),
        googleSub: "g-1",
      },
      error: null,
    });
    const { DELETE } = await import("./route");
    expect(await (await DELETE(jsonRequest("DELETE"), ctx)).json()).toEqual({
      ok: true,
    });
    expect(mocks.revoke).toHaveBeenCalledWith("1//rt");
  });

  it("still succeeds when the token cannot be opened, and 404s for others' connections", async () => {
    mocks.disconnect.mockResolvedValueOnce({
      data: { tokenEncrypted: "v1.x.y.z", googleSub: "g-1" },
      error: null,
    });
    const { DELETE } = await import("./route");
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(200);
    expect(mocks.revoke).not.toHaveBeenCalled();
    mocks.disconnect.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:not_found" },
    });
    expect((await DELETE(jsonRequest("DELETE"), ctx)).status).toBe(404);
  });
});
