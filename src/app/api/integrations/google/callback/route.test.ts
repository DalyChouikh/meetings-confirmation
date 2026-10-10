import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionAssociatedData,
  openSecret,
} from "@/server/crypto/secret-box";
import { encodeConnectCookie } from "@/server/google/google-oauth";

const KEY = randomBytes(32);
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  revoke: vi.fn(async () => true),
  save: vi.fn(),
  setSender: vi.fn(),
}));
vi.mock("@/config/public-env", () => ({
  publicEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: true,
  },
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "sec",
    GOOGLE_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
    LOG_LEVEL: "info",
  }),
}));
vi.mock("@/server/google/google-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/google/google-oauth")>()),
  exchangeGoogleCode: mocks.exchange,
  revokeGoogleToken: mocks.revoke,
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => ({ id: "user-1", email: null }),
}));
vi.mock("@/server/queries/workspaces", () => ({
  getWorkspaceBySlug: async () => ({
    id: "w1",
    slug: "club-ab12",
    myRole: "owner",
  }),
}));
vi.mock("@/server/supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({ admin: true }),
}));
vi.mock("@/server/queries/sender", () => ({
  saveGoogleConnection: mocks.save,
  setWorkspaceSender: mocks.setSender,
}));

const stored = {
  state: "s1",
  verifier: "v1",
  workspaceSlug: "club-ab12",
  next: null,
};
const callback = (query: string) =>
  new NextRequest(
    `http://localhost:3000/api/integrations/google/callback?${query}`,
    {
      headers: { cookie: `tn_gmail_connect=${encodeConnectCookie(stored)}` },
    },
  );
const grant = (overrides: object = {}) => ({
  refreshToken: "1//rt",
  scopes: ["openid", GMAIL_SEND],
  claims: { sub: "g-1", email: "club@gmail.com", emailVerified: true },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ data: "conn-1", error: null });
  mocks.setSender.mockResolvedValue({ error: null });
});

describe("GET /api/integrations/google/callback", () => {
  it("seals the refresh token, saves the connection, makes it the sender and clears the cookie", async () => {
    mocks.exchange.mockResolvedValueOnce(grant());
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/w/club-ab12/settings?gmail=connected#sending",
    );
    expect(mocks.save.mock.calls[0][0]).toEqual({ admin: true });
    const saved = mocks.save.mock.calls[0][1];
    expect(saved).toMatchObject({
      userId: "user-1",
      googleSub: "g-1",
      googleEmail: "club@gmail.com",
    });
    expect(
      openSecret(
        saved.tokenEncrypted,
        KEY,
        connectionAssociatedData("user-1", "g-1"),
      ),
    ).toBe("1//rt");
    expect(mocks.setSender).toHaveBeenCalledWith({}, "w1", "conn-1");
    expect(response.headers.get("set-cookie")).toMatch(/tn_gmail_connect=;/);
  });

  it.each([
    ["error=access_denied&state=s1", "cancelled"],
    ["code=c1&state=wrong", "failed"],
  ])("fails closed for %s", async (query, reason) => {
    const { GET } = await import("./route");
    const response = await GET(callback(query));
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/w/club-ab12/settings?gmail_error=${reason}#sending`,
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("refuses consent without gmail.send and revokes what Google issued", async () => {
    mocks.exchange.mockResolvedValueOnce(grant({ scopes: ["openid"] }));
    const { GET } = await import("./route");
    expect(
      (await GET(callback("code=c1&state=s1"))).headers.get("location"),
    ).toContain("gmail_error=scope_denied");
    expect(mocks.revoke).toHaveBeenCalledWith("1//rt");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("explains a missing refresh token", async () => {
    mocks.exchange.mockResolvedValueOnce(grant({ refreshToken: null }));
    const { GET } = await import("./route");
    expect(
      (await GET(callback("code=c1&state=s1"))).headers.get("location"),
    ).toContain("gmail_error=no_refresh_token");
  });
});
