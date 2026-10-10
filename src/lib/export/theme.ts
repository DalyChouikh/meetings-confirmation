import { palette } from "@/design/tokens";

/** Exports (Excel, Google Sheets) use the light palette: they are printed and shared. */
export const EXPORT_COLORS = palette.light;
/** Arial ships with Excel, Numbers and Google Sheets; the app's Space Grotesk does not. */
export const EXPORT_FONT_FAMILY = "Arial";
/** Body text size in points. */
export const EXPORT_FONT_SIZE = 11;
/** Title, subtitle, a gap, then the header: all four stay in place while scrolling. */
export const EXPORT_HEADER_ROWS = 4;
/** Column width cap, in characters. */
const WIDTH_MAX = 60;

/**
 * A column wide enough for its bold header and its longest value, at least `min` characters
 * (owner-approved Excel look, #257: bold headers need about 1.25 × their length + 3).
 */
export function fittedWidth(
  header: string,
  values: ReadonlyArray<string | number | null>,
  min: number,
): number {
  const longest = Math.max(
    0,
    ...values.map((value) => String(value ?? "").length),
  );
  return Math.min(
    WIDTH_MAX,
    Math.max(
      min,
      Math.ceil(header.length * 1.25) + 3,
      Math.ceil(longest * 1.1) + 2,
    ),
  );
}
