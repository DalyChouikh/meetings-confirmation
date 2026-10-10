import "server-only";
import { z } from "zod";
import { GOOGLE_TOKEN_ENDPOINT } from "./auth";
import { blankToUndefined, formatEnvError, type EnvSource } from "./env-utils";

const serverEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    SUPABASE_SECRET_KEY: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    SMTP_FROM: z.email(),
    SMTP_REQUIRE_TLS: z.stringbool().default(true),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    VERCEL_URL: z.string().min(1).optional(),
    VERCEL_BRANCH_URL: z.string().min(1).optional(),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
    INVITE_TOKEN_SECRET: z.string().min(32).optional(),
    DISPATCH_SECRET: z.string().min(32).optional(),
    GMAIL_API_BASE_URL: z.url().default("https://gmail.googleapis.com"),
    GOOGLE_OAUTH_TOKEN_URL: z.url().default(GOOGLE_TOKEN_ENDPOINT),
    /** Google Sheets API v4 (spec §10); e2e points it at the fake. */
    GOOGLE_SHEETS_API_BASE_URL: z
      .url()
      .default("https://sheets.googleapis.com"),
    /** Google Drive API v3 (spec §10); e2e points it at the fake. */
    GOOGLE_DRIVE_API_BASE_URL: z.url().default("https://www.googleapis.com"),
  })
  .superRefine((env, context) => {
    const pairs: ReadonlyArray<[keyof typeof env, keyof typeof env]> = [
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      ["SMTP_USER", "SMTP_PASS"],
    ];
    for (const [first, second] of pairs) {
      if (Boolean(env[first]) !== Boolean(env[second])) {
        const [missing, present] = env[first]
          ? [second, first]
          : [first, second];
        context.addIssue({
          code: "custom",
          path: [missing],
          message: `${missing} is required together with ${present}`,
        });
      }
    }
  });

/** Server-only environment variables (secrets live here, never in PublicEnv). */
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates server environment variables.
 * @throws Error naming every invalid or missing variable
 */
export function parseServerEnv(source: EnvSource): ServerEnv {
  const result = serverEnvSchema.safeParse(blankToUndefined(source));
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Returns the validated server env, parsing `process.env` once per process. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
