import { describe, expect, it, vi } from "vitest";
import {
  classifyGoogleResponse,
  createGoogleSheetsClient,
  type FetchLike,
} from "./sheets-client";

const error = (code: number, reason: string, status = "") =>
  JSON.stringify({
    error: {
      code,
      message: "x",
      status,
      errors: [{ reason }],
      details: [{ reason }],
    },
  });

describe("classifyGoogleResponse (spec §8 errors)", () => {
  it.each([
    [401, error(401, "authError"), { kind: "unauthorized" }],
    [403, error(403, "rateLimitExceeded"), { kind: "retry", status: 403 }],
    [403, error(403, "userRateLimitExceeded"), { kind: "retry", status: 403 }],
    [
      403,
      error(403, "accessNotConfigured"),
      { kind: "bug", status: 403, reason: "accessNotConfigured" },
    ],
    [
      403,
      error(403, "SERVICE_DISABLED", "PERMISSION_DENIED"),
      { kind: "bug", status: 403, reason: "SERVICE_DISABLED" },
    ],
    [403, error(403, "insufficientFilePermissions"), { kind: "access_lost" }],
    // S6: a token without the API's scope.
    [
      403,
      error(403, "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "PERMISSION_DENIED"),
      { kind: "access_lost" },
    ],
    // Sheets reports its per-minute limits as 429 RESOURCE_EXHAUSTED.
    [
      429,
      error(429, "RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED"),
      { kind: "retry", status: 429 },
    ],
    [404, error(404, "notFound"), { kind: "not_found" }],
    [429, error(429, "rateLimitExceeded"), { kind: "retry", status: 429 }],
    [503, "", { kind: "retry", status: 503 }],
    [
      400,
      error(400, "badRequest"),
      { kind: "bug", status: 400, reason: "badRequest" },
    ],
  ])("HTTP %i → %o", (status, body, expected) => {
    expect(classifyGoogleResponse(status, body)).toEqual(expected);
  });
});

describe("createGoogleSheetsClient", () => {
  const reply = (status: number, body: object) =>
    vi.fn<FetchLike>(
      async () => new Response(JSON.stringify(body), { status }),
    );

  it("creates the file through Drive with the TapNShow tag", async () => {
    const fetchImpl = reply(200, { id: "file-1" });
    const client = createGoogleSheetsClient({
      sheetsBaseUrl: "https://s",
      driveBaseUrl: "https://d",
      timeoutMs: 1000,
      fetchImpl,
    });
    const result = await client.createFile("tok", {
      name: "GDG · TapNShow",
      workspaceId: "w1",
      createKey: "k1",
    });
    expect(result).toEqual({ kind: "ok", value: "file-1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://d/drive/v3/files?fields=id");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "GDG · TapNShow",
      mimeType: "application/vnd.google-apps.spreadsheet",
      appProperties: { tapnshow_workspace: "w1", tapnshow_create_key: "k1" },
    });
  });

  it("finds a file it made before by its tag, or none", async () => {
    const client = createGoogleSheetsClient({
      sheetsBaseUrl: "https://s",
      driveBaseUrl: "https://d",
      timeoutMs: 1000,
      fetchImpl: reply(200, { files: [] }),
    });
    expect(await client.findFile("tok", "k1")).toEqual({
      kind: "ok",
      value: null,
    });
  });

  it("reads tab ids, titles, rule counts and slicers", async () => {
    const fetchImpl = reply(200, {
      sheets: [
        {
          properties: { sheetId: 0, title: "2026", index: 0 },
          conditionalFormats: [{}, {}],
          slicers: [{ slicerId: 9 }],
        },
      ],
    });
    const client = createGoogleSheetsClient({
      sheetsBaseUrl: "https://s",
      driveBaseUrl: "https://d",
      timeoutMs: 1000,
      fetchImpl,
    });
    expect(await client.readTabs("tok", "file-1")).toEqual({
      kind: "ok",
      value: [
        {
          sheetId: 0,
          title: "2026",
          index: 0,
          conditionalFormats: 2,
          slicerIds: [9],
        },
      ],
    });
  });

  it("turns a network failure or a timeout into a retry", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createGoogleSheetsClient({
      sheetsBaseUrl: "https://s",
      driveBaseUrl: "https://d",
      timeoutMs: 1000,
      fetchImpl,
    });
    expect(await client.fileTrashed("tok", "file-1")).toEqual({
      kind: "retry",
      status: 0,
    });
  });
});
