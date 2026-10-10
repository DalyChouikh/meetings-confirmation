import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import { changeSetSchema } from "@/shared/api/meeting-changes";
import {
  locationModeSchema,
  responseModeSchema,
} from "@/shared/api/meeting-settings";

/**
 * Every kind the dispatcher sends; one it doesn't know would fail the whole claim. Twin:
 * `public.job_kind` (M7 removed the kinds nobody used, so the two lists are equal).
 */
const jobKindSchema = z.enum([
  "invite",
  "calendar_confirm",
  "update",
  "cancel",
  "reminder",
]);

/**
 * What a job carries besides the invitee (spec §8; the M6 migration writes it). The defaults keep
 * rows without a payload parsing (invites, and every row claimed before M6). Unknown keys (the
 * stored calendar decision) are dropped: the reservation returns the decision.
 */
const jobPayloadSchema = z
  .object({
    changes: changeSetSchema.default({}),
    notify: z.boolean().default(false),
    reconfirm: z.boolean().default(false),
    audience: z.enum(["pending", "going"]).default("pending"),
  })
  .default({
    changes: {},
    notify: false,
    reconfirm: false,
    audience: "pending",
  });

/** One claimed job as `dispatch_claim` returns it, read into what the dispatcher renders. */
const jobSchema = z
  .object({
    job_id: z.uuid(),
    kind: jobKindSchema,
    payload: jobPayloadSchema,
    attempts: z.number().int(),
    invitee_id: z.uuid(),
    workspace_id: z.uuid(),
    workspace_name: z.string(),
    contact: z.object({ full_name: z.string(), email: z.string() }),
    meeting: z.object({
      id: z.uuid(),
      title: z.string(),
      agenda_md: z.string(),
      starts_at: z.string(),
      duration_minutes: z.number().int(),
      timezone: z.string(),
      location_mode: locationModeSchema,
      location_text: z.string(),
      online_text: z.string().default(""),
      meeting_url: z.string(),
      response_mode: responseModeSchema,
      response_deadline: z.string().nullable(),
      footer_note: z.string(),
      ics_uid: z.string(),
      thread_id: z.string().nullable(),
      root_message_id: z.string().nullable(),
    }),
  })
  .transform((job) => ({
    jobId: job.job_id,
    kind: job.kind,
    payload: job.payload,
    attempts: job.attempts,
    inviteeId: job.invitee_id,
    workspaceId: job.workspace_id,
    workspaceName: job.workspace_name,
    contact: { fullName: job.contact.full_name, email: job.contact.email },
    meeting: {
      id: job.meeting.id,
      title: job.meeting.title,
      agendaMd: job.meeting.agenda_md,
      startsAt: job.meeting.starts_at,
      durationMinutes: job.meeting.duration_minutes,
      timezone: job.meeting.timezone,
      locationMode: job.meeting.location_mode,
      locationText: job.meeting.location_text,
      onlineText: job.meeting.online_text,
      meetingUrl: job.meeting.meeting_url,
      responseMode: job.meeting.response_mode,
      responseDeadline: job.meeting.response_deadline,
      footerNote: job.meeting.footer_note,
      icsUid: job.meeting.ics_uid,
      threadId: job.meeting.thread_id,
      rootMessageId: job.meeting.root_message_id,
    },
  }));

/** The job's id alone, to hand back a job the dispatcher cannot read. */
const jobIdSchema = z.object({ job_id: z.uuid() });

const claimSchema = z.object({
  connection: z
    .object({
      id: z.uuid(),
      user_id: z.uuid(),
      google_sub: z.string(),
      google_email: z.string(),
      refresh_token_encrypted: z.string(),
    })
    .transform((db) => ({
      id: db.id,
      userId: db.user_id,
      googleSub: db.google_sub,
      googleEmail: db.google_email,
      refreshTokenEncrypted: db.refresh_token_encrypted,
    })),
  // Read one by one in parseClaim: a job this code can't read must not stop its sender's others.
  jobs: z.array(z.json()),
});

/** One claimed job with everything needed to render it. */
export type ClaimedJob = z.output<typeof jobSchema>;

/** One claimed sender, its readable jobs, and the ids of jobs it could not read. */
export type Claim = {
  connection: z.output<typeof claimSchema>["connection"];
  jobs: ClaimedJob[];
  /** Claimed jobs of an unknown kind or shape; the dispatcher hands them back to retry later. */
  unreadable: { jobId: string; issues: string[] }[];
};

/**
 * Parses `dispatch_claim`'s result (null when no sender has due jobs). Jobs are read one by one, so
 * one row this code doesn't understand (a kind shipped before its sender code, a bad payload) is
 * set aside instead of failing the claim. A failed claim would be claimed again first on every
 * run, stopping every workspace's emails.
 */
export function parseClaim(data: Json): Claim | null {
  if (!data) {
    return null;
  }
  const claim = claimSchema.parse(data);
  const jobs: ClaimedJob[] = [];
  const unreadable: Claim["unreadable"] = [];
  for (const raw of claim.jobs) {
    const job = jobSchema.safeParse(raw);
    if (job.success) {
      jobs.push(job.data);
      continue;
    }
    const id = jobIdSchema.safeParse(raw);
    if (id.success) {
      unreadable.push({
        jobId: id.data.job_id,
        issues: job.error.issues.map((issue) => issue.path.join(".")),
      });
    }
  }
  return { connection: claim.connection, jobs, unreadable };
}

/** A calendar job's decision at reserve time (spec §8 calendar_confirm). */
export type CalendarDecision = {
  action: "request" | "cancel";
  sequence: number;
};

const reserveSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ok"),
      calendar: z
        .object({
          action: z.enum(["request", "cancel"]),
          sequence: z.number().int(),
        })
        .optional(),
      /** The person unsubscribed: only the removal of a cancelled meeting from their calendar. */
      unsubscribed: z.literal(true).optional(),
    }),
    z.object({ kind: z.literal("quota"), retry_at: z.string() }),
    z.object({ kind: z.literal("done") }),
    z.object({ kind: z.literal("gone") }),
  ])
  .transform((db) => {
    switch (db.kind) {
      case "quota":
        return { kind: db.kind, retryAt: db.retry_at };
      case "ok":
        return {
          kind: db.kind,
          calendar: db.calendar ?? null,
          ...(db.unsubscribed && { unsubscribed: db.unsubscribed }),
        };
      default:
        return db;
    }
  });

/** What reserving quota for one job produced. */
export type ReserveResult = z.output<typeof reserveSchema>;

/** A job cleared to send, with its calendar decision. */
export type Reservation = Extract<ReserveResult, { kind: "ok" }>;

/** Reads what `dispatch_reserve` returned; throws on a shape this code doesn't know. */
export function parseReserve(data: Json): ReserveResult {
  return reserveSchema.parse(data);
}

/** One Owner to tell that their workspace's Gmail needs reconnecting. */
export type BrokenAlert = {
  email: string;
  workspaceName: string;
  workspaceSlug: string;
};

const brokenSchema = z
  .object({
    newly_broken: z.boolean(),
    alert: z.array(
      z.object({
        email: z.string(),
        workspace_name: z.string(),
        workspace_slug: z.string(),
      }),
    ),
  })
  .transform((db) => ({
    newlyBroken: db.newly_broken,
    alert: db.alert.map((a) => ({
      email: a.email,
      workspaceName: a.workspace_name,
      workspaceSlug: a.workspace_slug,
    })),
  }));

/** The dispatcher's view of the queue (service role; spec §8). Every method throws on a database error. */
export type DispatchStore = {
  claim(
    run: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<Claim | null>;
  /** Reserves quota and marks the send started; stores the invitee's token hash in the same step. */
  reserve(jobId: string, tokenHash: string): Promise<ReserveResult>;
  finish(
    jobId: string,
    outcome: "sent" | "skipped" | "failed" | "unknown",
    error: string | null,
    tokenHash: string | null,
  ): Promise<void>;
  retry(jobId: string, error: string): Promise<void>;
  unclaim(jobIds: string[]): Promise<void>;
  deferSender(
    run: string,
    connectionId: string,
    until: Date,
    error: string,
  ): Promise<void>;
  markBroken(
    run: string,
    connectionId: string,
    reason: string,
  ): Promise<{ newlyBroken: boolean; alert: BrokenAlert[] }>;
  setThread(
    meetingId: string,
    connectionId: string,
    threadId: string,
    rootMessageId: string,
  ): Promise<void>;
  release(run: string): Promise<void>;
};

function check(error: { message: string } | null): void {
  if (error) {
    throw new Error(`dispatch store: ${error.message}`);
  }
}

/** `DispatchStore` over the `dispatch_*` RPCs. `client` must be the service-role client. */
export function createDispatchStore(
  client: SupabaseClient<Database>,
): DispatchStore {
  return {
    async claim(run, limit, leaseSeconds) {
      const { data, error } = await client.rpc("dispatch_claim", {
        p_run: run,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      check(error);
      return parseClaim(data);
    },
    async reserve(jobId, tokenHash) {
      const { data, error } = await client.rpc("dispatch_reserve", {
        p_job: jobId,
        p_token_hash: tokenHash,
      });
      check(error);
      return parseReserve(data);
    },
    async finish(jobId, outcome, failure, tokenHash) {
      const { error } = await client.rpc("dispatch_finish", {
        p_job: jobId,
        p_outcome: outcome,
        p_error: sqlNullable(failure),
        p_token_hash: sqlNullable(tokenHash),
      });
      check(error);
    },
    async retry(jobId, failure) {
      const { error } = await client.rpc("dispatch_retry", {
        p_job: jobId,
        p_error: failure,
      });
      check(error);
    },
    async unclaim(jobIds) {
      if (jobIds.length === 0) {
        return;
      }
      const { error } = await client.rpc("dispatch_unclaim", {
        p_jobs: jobIds,
      });
      check(error);
    },
    async deferSender(run, connectionId, until, failure) {
      const { error } = await client.rpc("dispatch_defer_sender", {
        p_run: run,
        p_connection: connectionId,
        p_until: until.toISOString(),
        p_error: failure,
      });
      check(error);
    },
    async markBroken(run, connectionId, reason) {
      const { data, error } = await client.rpc("dispatch_mark_broken", {
        p_run: run,
        p_connection: connectionId,
        p_reason: reason,
      });
      check(error);
      return brokenSchema.parse(data);
    },
    async setThread(meetingId, connectionId, threadId, rootMessageId) {
      const { error } = await client.rpc("dispatch_set_thread", {
        p_meeting: meetingId,
        p_connection: connectionId,
        p_thread_id: threadId,
        p_root_message_id: rootMessageId,
      });
      check(error);
    },
    async release(run) {
      const { error } = await client.rpc("dispatch_release", { p_run: run });
      check(error);
    },
  };
}
