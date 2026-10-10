import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const supabase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
};

const smtp = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_FROM: "platform@example.test",
};

describe("parseServerEnv", () => {
  it("applies defaults", () => {
    const env = parseServerEnv({ ...supabase, ...smtp });
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("reads the Vercel environment name and rejects unknown ones", () => {
    expect(
      parseServerEnv({ ...supabase, ...smtp, VERCEL_ENV: "production" })
        .VERCEL_ENV,
    ).toBe("production");
    expect(() =>
      parseServerEnv({ ...supabase, ...smtp, VERCEL_ENV: "staging" }),
    ).toThrow(/VERCEL_ENV/);
  });

  it("rejects an unknown log level and names it", () => {
    expect(() =>
      parseServerEnv({ ...supabase, ...smtp, LOG_LEVEL: "loud" }),
    ).toThrow(/LOG_LEVEL/);
  });

  it("requires the Supabase keys and names the missing one", () => {
    expect(() =>
      parseServerEnv({ ...supabase, ...smtp, SUPABASE_SECRET_KEY: undefined }),
    ).toThrow(/SUPABASE_SECRET_KEY/);
    expect(
      parseServerEnv({ ...supabase, ...smtp }).NEXT_PUBLIC_SUPABASE_URL,
    ).toBe("https://abc.supabase.co");
  });

  it("parses SMTP settings with TLS required by default", () => {
    const env = parseServerEnv({ ...supabase, ...smtp });
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_REQUIRE_TLS).toBe(true);
    expect(
      parseServerEnv({ ...supabase, ...smtp, SMTP_REQUIRE_TLS: "false" })
        .SMTP_REQUIRE_TLS,
    ).toBe(false);
  });

  it("requires SMTP_FROM to be an email", () => {
    expect(() =>
      parseServerEnv({ ...supabase, ...smtp, SMTP_FROM: "nope" }),
    ).toThrow(/SMTP_FROM/);
  });

  it("requires the Google client ID and secret together", () => {
    expect(() =>
      parseServerEnv({
        ...supabase,
        ...smtp,
        GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
      }),
    ).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(
      parseServerEnv({ ...supabase, ...smtp }).GOOGLE_CLIENT_ID,
    ).toBeUndefined();
  });

  it("requires SMTP user and password together", () => {
    expect(() =>
      parseServerEnv({
        ...supabase,
        ...smtp,
        SMTP_USER: "platform@example.test",
      }),
    ).toThrow(/SMTP_PASS/);
  });

  it("keeps the M4 secrets optional and defaults the Google API URLs", () => {
    const env = parseServerEnv({ ...supabase, ...smtp });
    expect(env.INVITE_TOKEN_SECRET).toBeUndefined();
    expect(env.GMAIL_API_BASE_URL).toBe("https://gmail.googleapis.com");
    expect(env.GOOGLE_OAUTH_TOKEN_URL).toBe(
      "https://oauth2.googleapis.com/token",
    );
  });

  it("points the Google Sheet at Google unless overridden (e2e fakes)", () => {
    const env = parseServerEnv({ ...supabase, ...smtp });
    expect(env.GOOGLE_SHEETS_API_BASE_URL).toBe(
      "https://sheets.googleapis.com",
    );
    expect(env.GOOGLE_DRIVE_API_BASE_URL).toBe("https://www.googleapis.com");
  });

  it("rejects short M4 secrets and names them", () => {
    expect(() =>
      parseServerEnv({ ...supabase, ...smtp, DISPATCH_SECRET: "short" }),
    ).toThrow(/DISPATCH_SECRET/);
  });
});
