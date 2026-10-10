import { createTranslator } from "next-intl";
import type { Locale } from "@/config/i18n";
import type { AnswerLabels } from "@/lib/responses/describe-answer";
import type messages from "../../../messages/en.json";
import type { ExportColumnKey } from "./columns";
import type { ExportText } from "./rows";

/** The app's message catalogue type (every locale has the same shape). */
export type AppMessages = typeof messages;

/** The `Export` namespace translator (sheet titles and bands use it too). */
export type ExportTranslator = ReturnType<
  typeof createTranslator<AppMessages, "Export">
>;

/** Every word an export or a Google Sheet needs. */
export type ExportWords = {
  labels: AnswerLabels;
  text: ExportText;
  column: (key: ExportColumnKey) => string;
  t: ExportTranslator;
};

/**
 * The words for exports in one place, from React (`useLocale` + `useMessages`) or from the server
 * worker (the imported catalogue), so no caller lists translation keys itself.
 */
export function exportWords(
  locale: Locale,
  catalogue: AppMessages,
): ExportWords {
  const t = createTranslator({
    locale,
    messages: catalogue,
    namespace: "Export",
  });
  const answer = createTranslator({
    locale,
    messages: catalogue,
    namespace: "AnswerPage.answer",
  });
  const status = createTranslator({
    locale,
    messages: catalogue,
    namespace: "MeetingPage.status",
  });
  return {
    labels: {
      attending: answer("attending"),
      late: (minutes) => answer("late", { minutes }),
      absent: answer("absent"),
      not_attending: answer("not_attending"),
    },
    text: {
      yes: t("yes"),
      noReply: t("columns.noReply"),
      emailStatus: (value) => status(value),
      actual: (value) => t(`actual.${value}`),
    },
    column: (key) => t(`columns.${key}`),
    t,
  };
}
