import { describe, expect, it } from "vitest";
import { parseClaim, parseReserve } from "./dispatch";

/** One job as `dispatch_claim` returns it (snake_case, M5 shape: no `payload`). */
function dbJob(n: number, job: Record<string, string | object | null> = {}) {
  return {
    ...dbClaimRow({}).jobs[0],
    job_id: `00000000-0000-4000-8000-00000000000${n}`,
    ...job,
  };
}

/** One claim as `dispatch_claim` returns it (snake_case, M5 shape: no `payload`). */
function dbClaimRow(job: Record<string, string | object | null>) {
  return {
    connection: {
      id: "30000000-0000-4000-8000-000000000000",
      user_id: "40000000-0000-4000-8000-000000000000",
      google_sub: "g-1",
      google_email: "club@gmail.com",
      refresh_token_encrypted: "sealed",
    },
    jobs: [
      {
        job_id: "00000000-0000-4000-8000-000000000001",
        kind: "invite",
        attempts: 0,
        invitee_id: "10000000-0000-4000-8000-000000000001",
        workspace_id: "20000000-0000-4000-8000-000000000000",
        workspace_name: "GDG ISSAT",
        contact: { full_name: "Member 1", email: "m1@uni.tn" },
        meeting: {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Weekly sync",
          agenda_md: "",
          starts_at: "2026-10-09T17:00:00+00:00",
          duration_minutes: 60,
          timezone: "Africa/Tunis",
          location_mode: "in_person",
          location_text: "Room B12",
          online_text: "",
          meeting_url: "",
          response_mode: "attendance",
          response_deadline: null,
          footer_note: "Bring a laptop",
          ics_uid: "meeting-1@tapnshow.vercel.app",
          thread_id: null,
          root_message_id: null,
        },
        ...job,
      },
    ],
  };
}

describe("parseClaim", () => {
  it("still parses an invite claimed before the M6 migration (no payload)", () => {
    const claim = parseClaim(dbClaimRow({ kind: "invite" }));
    expect(claim?.jobs[0].payload).toEqual({
      changes: {},
      notify: false,
      reconfirm: false,
      audience: "pending",
    });
    expect(claim?.jobs[0].meeting.footerNote).toBe("Bring a laptop");
  });

  it("reads the M6 kinds and their payload", () => {
    const claim = parseClaim(
      dbClaimRow({
        kind: "update",
        // dispatch_reserve merges its calendar decision in at the top level (Task 5).
        payload: {
          changes: { title: ["Sync", "Weekly sync"] },
          notify: true,
          reconfirm: false,
          action: "request",
          sequence: 1,
        },
      }),
    );
    expect(claim?.jobs[0]).toMatchObject({
      kind: "update",
      payload: { changes: { title: ["Sync", "Weekly sync"] }, notify: true },
    });
  });

  it("reads a calendar job whose payload holds the stored decision", () => {
    const claim = parseClaim(
      dbClaimRow({
        kind: "calendar_confirm",
        payload: { action: "cancel", sequence: 2 },
      }),
    );
    expect(claim?.jobs[0].kind).toBe("calendar_confirm");
  });

  it("sets aside a job it can't read and keeps the others (one bad row must not stop sending)", () => {
    const row = dbClaimRow({});
    const claim = parseClaim({
      ...row,
      jobs: [
        dbJob(1, { kind: "fax" }),
        dbJob(2),
        dbJob(3, { payload: { changes: { title: [{}, "x"] } } }),
        { job_id: "not-a-uuid" },
      ],
    });
    expect(claim?.jobs.map((job) => job.jobId)).toEqual([
      "00000000-0000-4000-8000-000000000002",
    ]);
    expect(claim?.unreadable).toEqual([
      { jobId: "00000000-0000-4000-8000-000000000001", issues: ["kind"] },
      {
        jobId: "00000000-0000-4000-8000-000000000003",
        issues: ["payload.changes.title.0"],
      },
    ]);
  });

  it("returns null when there is nothing to claim", () => {
    expect(parseClaim(null)).toBeNull();
  });
});

describe("parseReserve", () => {
  it("keeps the calendar decision, and says when the person unsubscribed (calendar removal only)", () => {
    const calendar = { action: "cancel", sequence: 2 };
    expect(parseReserve({ kind: "ok", calendar })).toEqual({
      kind: "ok",
      calendar,
    });
    expect(parseReserve({ kind: "ok", calendar, unsubscribed: true })).toEqual({
      kind: "ok",
      calendar,
      unsubscribed: true,
    });
    expect(parseReserve({ kind: "ok" })).toEqual({
      kind: "ok",
      calendar: null,
    });
  });
});
