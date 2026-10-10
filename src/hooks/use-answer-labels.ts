"use client";

import { useLocale, useMessages } from "next-intl";
import { useMemo } from "react";
import { resolveLocale } from "@/config/i18n";
import { type ExportWords, exportWords } from "@/lib/export/words";
import type { AnswerLabels } from "@/lib/responses/describe-answer";

/** Every export word from the current messages (the export hooks), built once per locale. */
export function useExportWords(): ExportWords {
  const locale = resolveLocale(useLocale());
  const messages = useMessages();
  return useMemo(() => exportWords(locale, messages), [locale, messages]);
}

/** `AnswerLabels` from the current messages (answer page, meeting page, history). */
export function useAnswerLabels(): AnswerLabels {
  return useExportWords().labels;
}
