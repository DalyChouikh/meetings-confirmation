import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { exportWords } from "./words";

describe("exportWords", () => {
  const words = exportWords("en", messages);

  it("translates answers, delivery, check-ins and headers like the screens", () => {
    expect(words.labels.attending).toBe("Going");
    expect(words.labels.late(20)).toBe("Late by 20 min");
    expect(words.text.emailStatus("unknown")).toBe("Delivery unknown");
    expect(words.text.actual("present")).toBe("Present");
    expect(words.text.yes).toBe("Yes");
    expect(words.text.noReply).toBe("No reply");
    expect(words.column("wasLateBy")).toBe("Was late by (min)");
    expect(words.column("answeredAt")).toBe("Answered at");
  });
});
