import "server-only";
import { REFRESH_FAILURE_DEFER_MS, THROTTLE_DEFER_MS } from "@/config/meetings";
import { renderCalendarConfirmEmail } from "@/emails/calendar-confirm-email";
import { renderMeetingCancelEmail } from "@/emails/meeting-cancel-email";
import {
  type MeetingInviteEmailProps,
  renderMeetingInviteEmail,
} from "@/emails/meeting-invite-email";
import { renderMeetingReminderEmail } from "@/emails/meeting-reminder-email";
import { renderMeetingUpdateEmail } from "@/emails/meeting-update-email";
import {
  buildMeetingIcs,
  icsDescription,
  icsLocation,
} from "@/lib/calendar/ics";
import { logger } from "@/lib/logger";
import { hasMemberChanges } from "@/lib/meetings/changes";
import { inviteeTokenHash } from "@/server/crypto/invitee-token";
import type { GmailSendResult } from "@/server/gmail/gmail-client";
import { buildMeetingMime, newMessageId } from "@/server/gmail/mime";
import type { RefreshResult } from "@/server/google/google-oauth";
import type {
  BrokenAlert,
  CalendarDecision,
  Claim,
  ClaimedJob,
  DispatchStore,
  Reservation,
} from "@/server/queries/dispatch";

/** Everything the dispatcher touches, injected so tests run without Google or a database. */
export type DispatchDeps = {
  store: DispatchStore;
  gmail: (input: {
    accessToken: string;
    raw: string;
    threadId: string | null;
  }) => Promise<GmailSendResult>;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  openToken: (sealed: string, userId: string, googleSub: string) => string;
  tokenFor: (inviteeId: string) => string;
  appUrl: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  alertBroken: (alert: BrokenAlert[]) => Promise<void>;
  newRunId: () => string;
};

/** Tuning for one run (values from `src/config/meetings.ts` in production). */
export type DispatchOptions = {
  budgetMs: number;
  paceMs: number;
  batchSize: number;
  leaseSeconds: number;
};

/** What one run did (logged; returned for tests). */
export type DispatchSummary = {
  senders: number;
  sent: number;
  failed: number;
  skipped: number;
  unknown: number;
  deferred: number;
  /** Emails that carried a calendar invitation or removal (also counted in `sent`). */
  calendar: number;
  /** Update emails sent (also counted in `sent`). */
  updates: number;
  /** Cancellation emails sent (also counted in `sent`). */
  cancellations: number;
  /** Reminders sent (also counted in `sent`). */
  reminders: number;
};

/** The summary counter of each M6 kind (invites and calendar emails have their own). */
const KIND_COUNTER: Partial<
  Record<ClaimedJob["kind"], "updates" | "cancellations" | "reminders">
> = { update: "updates", cancel: "cancellations", reminder: "reminders" };

type Thread = { threadId: string; rootMessageId: string };
type Session = {
  claim: Claim;
  accessToken: string;
  threads: Map<string, Thread>;
};
type JobOutcome = "continue" | "stop";

/** Drains due jobs sender by sender within the time budget (spec §8). */
export async function runDispatch(
  deps: DispatchDeps,
  options: DispatchOptions,
): Promise<DispatchSummary> {
  const run = deps.newRunId();
  const started = deps.now();
  const summary: DispatchSummary = {
    senders: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    unknown: 0,
    deferred: 0,
    calendar: 0,
    updates: 0,
    cancellations: 0,
    reminders: 0,
  };
  const outOfTime = () => deps.now() - started >= options.budgetMs;
  try {
    while (!outOfTime()) {
      const claim = await deps.store.claim(
        run,
        options.batchSize,
        options.leaseSeconds,
      );
      if (!claim) {
        break;
      }
      summary.senders += 1;
      await drainSender(deps, options, run, claim, summary, outOfTime);
    }
  } finally {
    await deps.store.release(run);
  }
  logger.info({ summary }, "dispatch run finished");
  return summary;
}

async function breakSender(
  deps: DispatchDeps,
  run: string,
  claim: Claim,
  reason: string,
): Promise<void> {
  const result = await deps.store.markBroken(run, claim.connection.id, reason);
  if (result.alert.length > 0) {
    await deps
      .alertBroken(result.alert)
      .catch((error: Error) =>
        logger.error({ err: error }, "sender-broken alert failed"),
      );
  }
}

async function drainSender(
  deps: DispatchDeps,
  options: DispatchOptions,
  run: string,
  claim: Claim,
  summary: DispatchSummary,
  outOfTime: () => boolean,
): Promise<void> {
  for (const job of claim.unreadable) {
    // Back off and retry (failed after the max attempts): a later deploy may know this kind.
    logger.error(
      { jobId: job.jobId, issues: job.issues },
      "claimed job could not be read",
    );
    await deps.store.retry(job.jobId, "unreadable_job");
  }
  let refreshToken: string;
  try {
    refreshToken = deps.openToken(
      claim.connection.refreshTokenEncrypted,
      claim.connection.userId,
      claim.connection.googleSub,
    );
  } catch (error) {
    logger.error({ err: error }, "stored refresh token cannot be opened");
    await breakSender(deps, run, claim, "token_unreadable");
    return;
  }
  const refreshed = await deps.refresh(refreshToken);
  if (refreshed.kind === "invalid_grant") {
    await breakSender(deps, run, claim, "invalid_grant");
    return;
  }
  if (refreshed.kind === "error") {
    await deps.store.deferSender(
      run,
      claim.connection.id,
      new Date(deps.now() + REFRESH_FAILURE_DEFER_MS),
      "token_refresh_failed",
    );
    return;
  }
  const session: Session = {
    claim,
    accessToken: refreshed.accessToken,
    threads: new Map(
      claim.jobs
        .filter((job) => job.meeting.threadId && job.meeting.rootMessageId)
        .map((job) => [
          job.meeting.id,
          {
            threadId: job.meeting.threadId ?? "",
            rootMessageId: job.meeting.rootMessageId ?? "",
          },
        ]),
    ),
  };
  const queue = [...claim.jobs];
  while (queue.length > 0) {
    if (outOfTime()) {
      await deps.store.unclaim(queue.map((job) => job.jobId));
      return;
    }
    const claimed = queue.shift() as ClaimedJob;
    const reservation = await deps.store.reserve(
      claimed.jobId,
      inviteeTokenHash(deps.tokenFor(claimed.inviteeId)),
    );
    if (reservation.kind === "done") {
      summary.skipped += 1;
      continue;
    }
    if (reservation.kind === "gone") {
      continue;
    }
    if (reservation.kind === "quota") {
      summary.deferred += 1;
      // Every due job of this sender would hit the same cap: push them all to the window's
      // reopening in one call, so the next round claims another sender instead (#168).
      await deps.store.deferSender(
        run,
        claim.connection.id,
        new Date(reservation.retryAt),
        "quota",
      );
      return;
    }
    const job = reservation.unsubscribed ? calendarOnly(claimed) : claimed;
    if (
      job.kind === "update" &&
      !updateHasSomethingToSay(job, reservation.calendar)
    ) {
      // The database skips these at reserve time; never send an email that says nothing.
      await deps.store.finish(job.jobId, "skipped", "nothing_to_send", null);
      summary.skipped += 1;
      continue;
    }
    if (job.kind === "calendar_confirm" && !reservation.calendar) {
      // The database always decides a calendar job; never guess what to send.
      logger.error(
        { jobId: job.jobId },
        "calendar job reserved without a decision",
      );
      await deps.store.finish(
        job.jobId,
        "failed",
        "no_calendar_decision",
        null,
      );
      summary.failed += 1;
      continue;
    }
    const outcome = await sendJob(
      deps,
      run,
      session,
      job,
      reservation,
      summary,
    );
    if (outcome === "stop") {
      return;
    }
    await deps.sleep(options.paceMs);
  }
}

/**
 * An update says something when something members see changed or they are asked to confirm again,
 * and it goes to someone notified or carries a calendar update. Changes that cancelled out say
 * nothing, even to a calendar holder. Twin of the "nothing_to_send" rule in `dispatch_reserve`.
 */
function updateHasSomethingToSay(
  job: ClaimedJob,
  decision: CalendarDecision | null,
): boolean {
  const { changes, notify, reconfirm } = job.payload;
  return (
    (reconfirm || hasMemberChanges(changes)) && (decision !== null || notify)
  );
}

/**
 * Someone who unsubscribed after adding the meeting to their calendar gets only the event moved or
 * removed (owner decision 2026-10-10): never notified or asked to confirm. Twin of the
 * "unsubscribed" rules in `dispatch_reserve`.
 */
function calendarOnly(job: ClaimedJob): ClaimedJob {
  return {
    ...job,
    payload: { ...job.payload, notify: false, reconfirm: false },
  };
}

/** Renders one job's email by kind (the `.ics`, when any, is attached separately). */
async function renderJob(
  job: ClaimedJob,
  { calendar: decision }: Reservation,
  common: MeetingInviteEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  switch (job.kind) {
    case "invite":
      return renderMeetingInviteEmail(common);
    case "calendar_confirm":
      // drainSender never gets here without a decision for a calendar job.
      return renderCalendarConfirmEmail({
        ...common,
        action: decision?.action ?? "request",
      });
    case "update":
      return renderMeetingUpdateEmail({
        ...common,
        meeting: { ...common.meeting, footerNote: job.meeting.footerNote },
        changes: job.payload.changes,
        notify: job.payload.notify,
        reconfirm: job.payload.reconfirm,
        calendar: decision !== null,
      });
    case "cancel":
      return renderMeetingCancelEmail({
        ...common,
        calendar: decision !== null,
      });
    case "reminder":
      return renderMeetingReminderEmail({
        ...common,
        audience: job.payload.audience,
      });
  }
}

/** The calendar invitation (`.ics`) for one calendar job; it never carries the personal link. */
function calendarFile(
  deps: DispatchDeps,
  session: Session,
  job: ClaimedJob,
  decision: CalendarDecision,
): { method: "REQUEST" | "CANCEL"; ics: string } {
  const method = decision.action === "request" ? "REQUEST" : "CANCEL";
  return {
    method,
    ics: buildMeetingIcs({
      method,
      uid: job.meeting.icsUid,
      sequence: decision.sequence,
      stamp: new Date(deps.now()),
      start: new Date(job.meeting.startsAt),
      durationMinutes: job.meeting.durationMinutes,
      title: job.meeting.title,
      description: icsDescription(job.meeting),
      location: icsLocation(job.meeting),
      url:
        job.meeting.locationMode !== "in_person" && job.meeting.meetingUrl
          ? job.meeting.meetingUrl
          : null,
      organizer: {
        name: job.workspaceName,
        email: session.claim.connection.googleEmail,
      },
      attendee: { name: job.contact.fullName, email: job.contact.email },
    }),
  };
}

async function sendJob(
  deps: DispatchDeps,
  run: string,
  session: Session,
  job: ClaimedJob,
  reservation: Reservation,
  summary: DispatchSummary,
): Promise<JobOutcome> {
  const decision = reservation.calendar;
  const token = deps.tokenFor(job.inviteeId);
  const links = {
    respond: `${deps.appUrl}/r/${token}`,
    unsubscribe: `${deps.appUrl}/u/${token}`,
    report: `${deps.appUrl}/report/${token}`,
  };
  const common: MeetingInviteEmailProps = {
    workspaceName: job.workspaceName,
    recipientName: job.contact.fullName,
    senderEmail: session.claim.connection.googleEmail,
    meeting: job.meeting,
    links,
    now: new Date(deps.now()),
    unsubscribed: reservation.unsubscribed,
  };
  const email = await renderJob(job, reservation, common);
  const calendar = decision
    ? calendarFile(deps, session, job, decision)
    : undefined;
  const attempt = async (thread: Thread | undefined) => {
    const messageId = newMessageId(deps.appUrl);
    const raw = await buildMeetingMime({
      from: {
        name: job.workspaceName,
        address: session.claim.connection.googleEmail,
      },
      to: { name: job.contact.fullName, address: job.contact.email },
      subject: email.subject,
      html: email.html,
      text: email.text,
      messageId,
      inReplyTo: thread?.rootMessageId ?? null,
      listUnsubscribeUrl: `${deps.appUrl}/api/r/${token}/unsubscribe`,
      calendar,
    });
    return {
      messageId,
      result: await deps.gmail({
        accessToken: session.accessToken,
        raw,
        threadId: thread?.threadId ?? null,
      }),
    };
  };

  let thread = session.threads.get(job.meeting.id);
  let { messageId, result } = await attempt(thread);
  if (result.kind === "auth") {
    const again = await deps.refresh(
      deps.openToken(
        session.claim.connection.refreshTokenEncrypted,
        session.claim.connection.userId,
        session.claim.connection.googleSub,
      ),
    );
    if (again.kind !== "ok") {
      await deps.store.unclaim([job.jobId]);
      await breakSender(
        deps,
        run,
        session.claim,
        again.kind === "invalid_grant"
          ? "invalid_grant"
          : "token_refresh_failed",
      );
      return "stop";
    }
    session.accessToken = again.accessToken;
    ({ messageId, result } = await attempt(thread));
  }
  if (result.kind === "thread_missing" && thread) {
    session.threads.delete(job.meeting.id);
    thread = undefined;
    ({ messageId, result } = await attempt(thread));
  }

  switch (result.kind) {
    case "sent":
      if (!thread) {
        session.threads.set(job.meeting.id, {
          threadId: result.threadId,
          rootMessageId: messageId,
        });
        await deps.store.setThread(
          job.meeting.id,
          session.claim.connection.id,
          result.threadId,
          messageId,
        );
      }
      await deps.store.finish(job.jobId, "sent", null, inviteeTokenHash(token));
      summary.sent += 1;
      if (decision) {
        summary.calendar += 1;
      }
      const counter = KIND_COUNTER[job.kind];
      if (counter) {
        summary[counter] += 1;
      }
      return "continue";
    case "invalid_recipient":
      await deps.store.finish(job.jobId, "failed", result.reason, null);
      summary.failed += 1;
      return "continue";
    case "thread_missing":
      await deps.store.retry(job.jobId, "thread_missing");
      return "continue";
    case "retry":
      await deps.store.retry(job.jobId, `http_${result.status}`);
      return "continue";
    case "unknown":
      await deps.store.finish(job.jobId, "unknown", "delivery_unknown", null);
      summary.unknown += 1;
      return "continue";
    case "throttled":
      await deps.store.deferSender(
        run,
        session.claim.connection.id,
        new Date(deps.now() + THROTTLE_DEFER_MS),
        "gmail_throttled",
      );
      summary.deferred += 1;
      return "stop";
    case "forbidden":
    case "auth":
      await breakSender(
        deps,
        run,
        session.claim,
        result.kind === "forbidden" ? result.reason : "auth",
      );
      return "stop";
  }
}
