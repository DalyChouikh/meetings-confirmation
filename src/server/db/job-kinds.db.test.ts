import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryLocalSql } from "@/test/db/sql";

describe("outbox job kinds (spec §6)", () => {
  it("are exactly the five the dispatcher sends", () => {
    const rows = queryLocalSql(
      "select e.enumlabel as label from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid where t.typname = 'job_kind' and t.typnamespace = 'public'::regnamespace order by e.enumsortorder",
      z.array(z.object({ label: z.string() })),
    );
    expect(rows.map((row) => row.label)).toEqual([
      "invite",
      "calendar_confirm",
      "update",
      "cancel",
      "reminder",
    ]);
  });

  it("keeps the due-timer index the reminder fan-out reads", () => {
    const rows = queryLocalSql(
      "select indexdef as def from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'outbox_jobs_due_timers_idx'",
      z.array(z.object({ def: z.string() })).length(1),
    );
    expect(rows[0].def).toContain(
      "WHERE ((kind = 'reminder'::job_kind) AND (invitee_id IS NULL) AND (status = 'pending'::job_status))",
    );
  });
});
