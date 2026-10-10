import { describe, expect, it, vi } from "vitest";
import {
  createGoogleConnectAuthorization,
  decodeConnectCookie,
  decodeIdTokenClaims,
  encodeConnectCookie,
  exchangeGoogleCode,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from "./google-oauth";

const idToken = (claims: object) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
const jsonResponse = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("createGoogleConnectAuthorization", () => {
  it("asks for offline gmail.send with PKCE, consent and incremental scopes", () => {
    const { url, state } = createGoogleConnectAuthorization({
      clientId: "client",
      redirectUri:
        "https://tapnshow.vercel.app/api/integrations/google/callback",
      workspaceSlug: "club-ab12",
      next: "/w/club-ab12/settings",
    });
    const params = new URL(url).searchParams;
    expect(params.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/gmail.send",
    );
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent select_account");
    expect(params.get("include_granted_scopes")).toBe("true");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBe(state.state);
    expect(state.workspaceSlug).toBe("club-ab12");
  });
});

describe("connect cookie", () => {
  it("round-trips and rejects junk", () => {
    const state = {
      state: "s",
      verifier: "v",
      workspaceSlug: "club",
      next: null,
    };
    expect(decodeConnectCookie(encodeConnectCookie(state))).toEqual(state);
    expect(decodeConnectCookie("not-base64-json")).toBeNull();
    expect(decodeConnectCookie(undefined)).toBeNull();
  });
});

describe("exchangeGoogleCode", () => {
  it("returns the refresh token, granted scopes and verified claims", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: "at",
        refresh_token: "rt",
        scope:
          "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send",
        id_token: idToken({
          sub: "123",
          email: "Club@Gmail.com",
          email_verified: true,
        }),
      }),
    );
    const grant = await exchangeGoogleCode(
      {
        code: "c",
        verifier: "v",
        clientId: "id",
        clientSecret: "secret",
        redirectUri: "https://x/cb",
      },
      fetchMock,
    );
    expect(grant).toEqual({
      refreshToken: "rt",
      scopes: [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      claims: { sub: "123", email: "club@gmail.com", emailVerified: true },
    });
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("v");
  });

  it("reports a missing refresh token as null and hides Google's error body", async () => {
    const noRefresh = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: "at",
        scope: "openid",
        id_token: idToken({
          sub: "1",
          email: "a@b.co",
          email_verified: true,
        }),
      }),
    );
    const grant = await exchangeGoogleCode(
      {
        code: "c",
        verifier: "v",
        clientId: "id",
        clientSecret: "s",
        redirectUri: "https://x/cb",
      },
      noRefresh,
    );
    expect(grant.refreshToken).toBeNull();
    const failing = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: "invalid_grant", code: "c" }, 400),
      );
    await expect(
      exchangeGoogleCode(
        {
          code: "c",
          verifier: "v",
          clientId: "id",
          clientSecret: "s",
          redirectUri: "https://x/cb",
        },
        failing,
      ),
    ).rejects.toThrow("Google token exchange failed with HTTP 400");
  });
});

describe("decodeIdTokenClaims", () => {
  it("rejects tokens without sub or email", () => {
    expect(() => decodeIdTokenClaims(idToken({ email: "a@b.co" }))).toThrow();
    expect(() => decodeIdTokenClaims("garbage")).toThrow();
  });
});

describe("refreshGoogleAccessToken", () => {
  const input = {
    refreshToken: "rt",
    clientId: "id",
    clientSecret: "s",
    tokenUrl: "https://oauth2.googleapis.com/token",
  };

  it("returns an access token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ access_token: "at", expires_in: 3599 }),
      );
    expect(await refreshGoogleAccessToken(input, fetchMock)).toEqual({
      kind: "ok",
      accessToken: "at",
    });
  });

  it("recognizes invalid_grant and other failures", async () => {
    const revoked = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400));
    expect(await refreshGoogleAccessToken(input, revoked)).toEqual({
      kind: "invalid_grant",
    });
    const down = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "server_error" }, 503));
    expect(await refreshGoogleAccessToken(input, down)).toEqual({
      kind: "error",
      status: 503,
    });
    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    expect(await refreshGoogleAccessToken(input, offline)).toEqual({
      kind: "error",
      status: 0,
    });
  });
});

describe("revokeGoogleToken", () => {
  it("posts the token form-encoded and never throws", async () => {
    const ok = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 200 }));
    expect(await revokeGoogleToken("rt", ok)).toBe(true);
    expect(String(ok.mock.calls[0][1]?.body)).toBe("token=rt");
    const offline = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    expect(await revokeGoogleToken("rt", offline)).toBe(false);
  });
});
