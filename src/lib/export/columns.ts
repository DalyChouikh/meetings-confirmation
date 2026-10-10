import type { FillTone } from "@/design/tokens";
import type messages from "../../../messages/en.json";

/** A column header key under `Export.columns`. */
export type ExportColumnKey = keyof (typeof messages)["Export"]["columns"];

/** One export column: its header key, its minimum width in characters, an optional header tone. */
export type ExportColumn = {
  key: ExportColumnKey;
  width: number;
  tone?: FillTone;
};

/** Meeting answers (`meetingAnswerRows`), the meeting page's export. */
export const ANSWER_COLUMNS: ReadonlyArray<ExportColumn> = [
  { key: "name", width: 24 },
  { key: "email", width: 30 },
  { key: "lists", width: 20 },
  { key: "answer", width: 18 },
  { key: "lateBy", width: 12 },
  { key: "reason", width: 40 },
  { key: "comment", width: 40 },
  { key: "answeredAt", width: 18 },
  { key: "afterDeadline", width: 16 },
  { key: "emailStatus", width: 16 },
  { key: "checkedIn", width: 14 },
  { key: "checkedInBy", width: 24 },
  { key: "wasLateBy", width: 14 },
];

/** Attendance summary (`attendanceSummaryRows`). */
export const SUMMARY_COLUMNS: ReadonlyArray<ExportColumn> = [
  { key: "name", width: 24 },
  { key: "email", width: 30 },
  { key: "lists", width: 20 },
  { key: "invited", width: 10 },
  { key: "attending", width: 10, tone: "success" },
  { key: "late", width: 10, tone: "warning" },
  { key: "absent", width: 10, tone: "danger" },
  { key: "noReply", width: 10, tone: "neutral" },
];

/**
 * One row per person per meeting (`attendanceDetailRows`): the Attendance Details sheet and every
 * Google Sheet tab (spec §7.17), so both always have the same columns.
 */
export const DETAIL_COLUMNS: ReadonlyArray<ExportColumn> = [
  { key: "meeting", width: 30 },
  { key: "date", width: 18 },
  ...ANSWER_COLUMNS,
];
