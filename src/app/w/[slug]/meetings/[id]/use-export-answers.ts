"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { ExportFormat } from "@/components/forms/export-menu";
import { useExportWords } from "@/hooks/use-answer-labels";
import { fetchAllMeetingPeople } from "@/hooks/use-results";
import { rosterQueryOptions } from "@/hooks/use-roster";
import { useWorkspace } from "@/hooks/use-workspace";
import { ANSWER_COLUMNS } from "@/lib/export/columns";
import { listNamesByContact, meetingAnswerRows } from "@/lib/export/rows";
import { saveExport } from "@/lib/export/save";
import { formatDeadline, formatMeetingWhen } from "@/lib/meetings/format";
import type { Meeting } from "@/shared/api/meetings";

/**
 * The meeting page's export (spec §7.7): every invitee with their answer, built on the device as
 * CSV or Excel, named `<workspace>-<title>-answers-<date>`. Excel's title band names the meeting,
 * the workspace, when it is and when it was exported.
 */
export function useExportAnswers(slug: string, meeting: Meeting) {
  const words = useExportWords();
  const { t } = words;
  const queryClient = useQueryClient();
  const workspace = useWorkspace(slug);
  return async (format: ExportFormat): Promise<void> => {
    const [people, roster] = await Promise.all([
      fetchAllMeetingPeople(slug, meeting.id),
      queryClient.fetchQuery(rosterQueryOptions(slug)),
    ]);
    const rows = meetingAnswerRows(
      people,
      listNamesByContact(roster),
      words.labels,
      words.text,
      meeting.timezone,
    );
    const now = new Date();
    const context = meeting.startsAt
      ? t("meetingContext", {
          workspace: workspace.data?.name ?? slug,
          ...formatMeetingWhen({ ...meeting, startsAt: meeting.startsAt }),
        })
      : (workspace.data?.name ?? slug);
    await saveExport(
      format,
      [
        {
          name: t("sheetAnswers"),
          title: t("title", { what: meeting.title, sheet: t("sheetAnswers") }),
          subtitle: t("exported", {
            context,
            at: formatDeadline(now.toISOString(), meeting.timezone),
          }),
          columns: ANSWER_COLUMNS.map((column) => ({
            header: words.column(column.key),
            width: column.width,
          })),
          rows,
        },
      ],
      [slug, meeting.title, "answers"],
      now,
    );
  };
}
