import { describe, expect, it } from "vitest";
import { palette } from "@/design/tokens";
import { EXPORT_COLORS, EXPORT_HEADER_ROWS, fittedWidth } from "./theme";

describe("export theme", () => {
  it("uses the light palette and four frozen rows (title, subtitle, gap, header)", () => {
    expect(EXPORT_COLORS).toBe(palette.light);
    expect(EXPORT_HEADER_ROWS).toBe(4);
  });

  it("fits the bold header, the longest value, and never goes over 60 characters", () => {
    expect(fittedWidth("Was late by (min)", [5], 14)).toBe(25);
    expect(fittedWidth("Name", ["Sarra Ben Abdallah El Mekki"], 24)).toBe(32);
    expect(fittedWidth("Reason", ["x".repeat(300)], 40)).toBe(60);
  });
});
