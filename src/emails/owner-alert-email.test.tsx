import { describe, expect, it } from "vitest";
import { renderOwnerAlertEmail } from "./owner-alert-email";

const EMOJI = /\p{Extended_Pictographic}/u;
const SENDING = "https://tapnshow.vercel.app/w/gdg-ab12/settings#sending";
const SHEETS = "https://tapnshow.vercel.app/w/gdg-ab12/settings#sheets";

describe("renderOwnerAlertEmail", () => {
  it("keeps the sender-broken wording and links Sending settings", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "senderBroken",
      workspaceName: "GDG ISSAT",
      settingsUrl: SENDING,
    });
    expect(email.subject).toBe(
      "Gmail sending for GDG ISSAT needs reconnecting",
    );
    expect(email.text).toContain("Reconnect Gmail");
    expect(email.text).toContain("nothing is lost");
    expect(email.html).toContain(`href="${SENDING}"`);
    expect(email.text).toContain(SENDING);
    expect(email.html).not.toMatch(EMOJI);
  });

  it("says the Google Sheet stopped updating, with the reason in plain words", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "sheetPaused",
      reason: "trashed",
      workspaceName: "GDG ISSAT",
      settingsUrl: SHEETS,
    });
    expect(email.subject).toBe(
      "The Google Sheet of GDG ISSAT stopped updating",
    );
    expect(email.text).toContain("moved to the trash");
    expect(email.text).toContain("Open Settings");
    expect(email.html).toContain(`href="${SHEETS}"`);
    expect(email.html).not.toMatch(/token|scope|API/i);
    expect(email.html).not.toMatch(EMOJI);
  });

  it.each(["deleted", "access_lost", "full"] as const)(
    "has a plain line for a sheet paused as %s",
    async (reason) => {
      const email = await renderOwnerAlertEmail({
        kind: "sheetPaused",
        reason,
        workspaceName: "GDG ISSAT",
        settingsUrl: SHEETS,
      });
      expect(email.text).toMatch(/Google Sheet/);
      expect(email.text).not.toMatch(/sheetPaused|body\./);
    },
  );

  it("escapes workspace names that contain HTML", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "senderBroken",
      workspaceName: "<b>Club</b>",
      settingsUrl: SENDING,
    });
    expect(email.html).not.toContain("<b>Club</b>");
    expect(email.html).toContain("&lt;b&gt;Club&lt;/b&gt;");
  });
});
