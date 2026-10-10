"use client";

import type { ExportFormat } from "@/components/forms/export-menu";
import { useExportWords } from "@/hooks/use-answer-labels";
import { fetchAllAttendanceDetails } from "@/hooks/use-results";
import {
  DETAIL_COLUMNS,
  type ExportColumn,
  SUMMARY_COLUMNS,
} from "@/lib/export/columns";
import {
  attendanceDetailRows,
  attendanceSummaryRows,
  listNamesByContact,
} from "@/lib/export/rows";
import { saveExport } from "@/lib/export/save";
import { formatDeadline } from "@/lib/meetings/format";
import type { PeriodRange } from "@/shared/api/responses";
import type { Roster } from "@/shared/api/roster";

/** One Attendance row as shown (the view's filter and order). */
export type AttendanceExportRow = Parameters<
  typeof attendanceSummaryRows
>[0][number];

/**
 * The Attendance export (spec §7.7): CSV is the summary as shown; Excel adds a Details sheet
 * (one row per person per counted meeting) for the same people and period. Excel's title band
 * names the sheet, the workspace, the period (`periodLabel`, as the chips say it) and the export
 * time in the workspace's zone.
 */
export function useExportAttendance(
  workspace: { slug: string; name: string; timezone: string },
  roster: Roster,
  range: PeriodRange,
  periodLabel: string,
) {
  const words = useExportWords();
  const { t } = words;
  const { slug } = workspace;
  const header = (columns: ReadonlyArray<ExportColumn>) =>
    columns.map((column) => ({
      header: words.column(column.key),
      width: column.width,
      tone: column.tone,
    }));
  return async (
    format: ExportFormat,
    shown: AttendanceExportRow[],
  ): Promise<void> => {
    const listNames = listNamesByContact(roster);
    const now = new Date();
    const band = (sheet: string) => ({
      name: sheet,
      title: t("title", { what: t("attendance"), sheet }),
      subtitle: t("exported", {
        context: t("periodContext", {
          workspace: workspace.name,
          period: periodLabel,
        }),
        at: formatDeadline(now.toISOString(), workspace.timezone),
      }),
    });
    const summary = {
      ...band(t("sheetSummary")),
      columns: header(SUMMARY_COLUMNS),
      rows: attendanceSummaryRows(shown, listNames),
    };
    if (format === "csv") {
      await saveExport(format, [summary], [slug, "attendance"], now);
      return;
    }
    const people = new Set(shown.map((row) => row.contactId));
    const details = (await fetchAllAttendanceDetails(slug, range)).filter(
      (row) => people.has(row.contactId),
    );
    await saveExport(
      format,
      [
        summary,
        {
          ...band(t("sheetDetails")),
          columns: header(DETAIL_COLUMNS),
          rows: attendanceDetailRows(
            details,
            listNames,
            words.labels,
            words.text,
          ),
        },
      ],
      [slug, "attendance"],
      now,
    );
  };
}
