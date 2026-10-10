import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import type { AnswerLabels } from "@/lib/responses/describe-answer";
import type { AttendanceDetailRow, PersonRow } from "@/shared/api/responses";
import {
  attendanceDetailRows,
  attendanceSummaryRows,
  listNamesByContact,
  meetingAnswerRows,
  type ExportText,
} from "./rows";
import { exportWords } from "./words";

const labels: AnswerLabels = {
  attending: "Going",
  late: (m) => `Late by ${m} min`,
  absent: "Can't come",
  not_attending: "Not going",
};
const text: ExportText = {
  yes: "Yes",
  noReply: "No reply",
  emailStatus: (status) => `email:${status}`,
  actual: (value) => `was:${value}`,
};
const person = (over: Partial<PersonRow>): PersonRow => ({
  inviteeId: "00000000-0000-4000-8000-000000000001",
  contactId: "10000000-0000-4000-8000-000000000001",
  fullName: "Amira, B.",
  email: "amira@uni.tn",
  isAdhoc: false,
  emailStatus: "sent",
  emailError: null,
  sentAt: null,
  answer: null,
  mark: null,
  ...over,
});

describe("export rows", () => {
  it("writes one meeting row per person, in the meeting's zone, reasons untouched", () => {
    const long = `=cmd ${"x".repeat(600)}`;
    const rows = meetingAnswerRows(
      [
        person({
          answer: {
            status: "late",
            delayMinutes: 20,
            reason: long,
            comment: "",
            afterDeadline: true,
            needsReconfirmation: false,
            updatedAt: "2026-10-09T10:05:00+00:00",
          },
        }),
        person({ fullName: "Guest", isAdhoc: true, emailStatus: "failed" }),
        person({ fullName: "Silent" }),
      ],
      new Map([["10000000-0000-4000-8000-000000000001", ["Design", "Dev"]]]),
      labels,
      text,
      "Africa/Tunis",
    );
    expect(rows[0]).toEqual([
      "Amira, B.",
      "amira@uni.tn",
      "Design, Dev",
      { text: "Late by 20 min", tone: "warning" },
      20,
      long,
      "",
      "2026-10-09 11:05",
      "Yes",
      "email:sent",
      "",
      "",
      null,
    ]);
    expect(rows[1][3]).toBe("");
    expect(rows[2][3]).toEqual({ text: "No reply", tone: "neutral" });
  });

  it("summarizes attendance in the given order and lists details per meeting", () => {
    const summary = attendanceSummaryRows(
      [
        {
          contactId: "c1",
          fullName: "Omar",
          email: "o@uni.tn",
          invited: 4,
          attending: 0,
          late: 0,
          absent: 1,
          noReply: 3,
        },
      ],
      new Map([["c1", []]]),
    );
    expect(summary).toEqual([["Omar", "o@uni.tn", "", 4, 0, 0, 1, 3]]);
    const detail: AttendanceDetailRow = {
      meetingId: "m1",
      title: "Weekly sync",
      startsAt: "2026-10-02T17:00:00+00:00",
      timezone: "Africa/Tunis",
      responseMode: "attendance",
      inviteeId: "i1",
      contactId: "c1",
      fullName: "Omar",
      email: "o@uni.tn",
      emailStatus: "sent",
      answer: null,
      mark: null,
    };
    expect(attendanceDetailRows([detail], new Map(), labels, text)[0]).toEqual([
      "Weekly sync",
      "2026-10-02 18:00",
      "Omar",
      "o@uni.tn",
      "",
      { text: "No reply", tone: "neutral" },
      null,
      "",
      "",
      "",
      "",
      "email:sent",
      "",
      "",
      null,
    ]);
  });

  it("adds who actually came and who checked them in (M6)", () => {
    const mark = {
      actual: "absent" as const,
      markedAt: "2026-10-09T17:05:00.000Z",
      markedByName: "Amira Ben Ali",
      lateMinutes: null,
    };
    const [row] = meetingAnswerRows(
      [person({ mark })],
      new Map(),
      labels,
      text,
      "Africa/Tunis",
    );
    expect(row.slice(-3)).toEqual([
      { text: "was:absent", tone: "danger" },
      "Amira Ben Ali",
      null,
    ]);
    const [late] = meetingAnswerRows(
      [person({ mark: { ...mark, actual: "late", lateMinutes: 15 } })],
      new Map(),
      labels,
      text,
      "Africa/Tunis",
    );
    expect(late.slice(-3)).toEqual([
      { text: "was:late", tone: "warning" },
      "Amira Ben Ali",
      15,
    ]);
    const detail: AttendanceDetailRow = {
      meetingId: "m1",
      title: "Weekly sync",
      startsAt: "2026-10-02T17:00:00+00:00",
      timezone: "Africa/Tunis",
      responseMode: "attendance",
      inviteeId: "i1",
      contactId: "c1",
      fullName: "Omar",
      email: "o@uni.tn",
      emailStatus: "sent",
      answer: null,
      mark,
    };
    expect(
      attendanceDetailRows([detail], new Map(), labels, text)[0].slice(-3),
    ).toEqual([{ text: "was:absent", tone: "danger" }, "Amira Ben Ali", null]);
  });
});

describe("attendanceDetailRows with the app's words", () => {
  const words = exportWords("en", messages);
  const detail: AttendanceDetailRow = {
    meetingId: "m1",
    title: "Weekly sync",
    startsAt: "2026-10-08T17:00:00.000Z",
    timezone: "Africa/Tunis",
    responseMode: "attendance",
    inviteeId: "i1",
    contactId: "c1",
    fullName: "Omar",
    email: "o@uni.tn",
    emailStatus: "sent",
    answer: {
      status: "attending",
      delayMinutes: null,
      reason: "",
      comment: "See you there",
      afterDeadline: false,
      needsReconfirmation: false,
      updatedAt: "2026-10-08T18:05:00.000Z",
    },
    mark: null,
  };

  it("puts Answered at (meeting zone) after Comment, like the meeting export", () => {
    const [row] = attendanceDetailRows(
      [detail],
      new Map(),
      words.labels,
      words.text,
    );
    expect(row).toHaveLength(15);
    expect(row[8]).toBe(detail.answer?.comment ?? "");
    expect(row[9]).toBe("2026-10-08 19:05");
  });

  it("lets the Google Sheet name the meeting cell its own way", () => {
    const [row] = attendanceDetailRows(
      [detail],
      new Map(),
      words.labels,
      words.text,
      { meetingCell: () => "Weekly sync · Thu 8 Oct" },
    );
    expect(row[0]).toBe("Weekly sync · Thu 8 Oct");
  });
});

describe("listNamesByContact", () => {
  it("maps each person to their list names, in the roster's list order", () => {
    const names = listNamesByContact({
      contacts: [
        { id: "c1", listIds: ["l2", "l1"] },
        { id: "c2", listIds: [] },
      ],
      lists: [
        { id: "l1", name: "Design" },
        { id: "l2", name: "Core team" },
      ],
    });
    expect(names.get("c1")).toEqual(["Design", "Core team"]);
    expect(names.get("c2")).toEqual([]);
  });
});
