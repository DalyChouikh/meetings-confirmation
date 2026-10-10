import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import readXlsxFile from "read-excel-file/universal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "@/lib/export/download";
import { routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { setWideViewport } from "@/test/match-media";
import { renderWithProviders } from "@/test/render";
import type { Roster } from "@/shared/api/roster";
import { AttendanceView } from "./attendance-view";

vi.mock("@/lib/export/download", () => ({ downloadBlob: vi.fn() }));

const LIST = "7a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6a1";
const ids = ["1", "2", "3"].map(
  (n) => `6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6a${n}`,
);
const roster = {
  contacts: [
    {
      id: ids[0],
      fullName: "Amira B.",
      email: "a@uni.tn",
      listIds: [LIST],
      unsubscribed: false,
      reported: false,
    },
    {
      id: ids[1],
      fullName: "Omar D.",
      email: "o@uni.tn",
      listIds: [],
      unsubscribed: false,
      reported: false,
    },
    {
      id: ids[2],
      fullName: "Youssef K.",
      email: "y@uni.tn",
      listIds: [LIST],
      unsubscribed: false,
      reported: false,
    },
  ],
  lists: [{ id: LIST, name: "Design", contactCount: 2 }],
  limits: { contactsMax: 2000, listsMax: 50, importRowsMax: 2000 },
} satisfies Roster;
const summary = {
  meetings: 4,
  rows: [
    {
      contactId: ids[0],
      invited: 4,
      attending: 1,
      late: 3,
      absent: 0,
      noReply: 0,
    },
    {
      contactId: ids[1],
      invited: 4,
      attending: 0,
      late: 0,
      absent: 1,
      noReply: 3,
    },
    {
      contactId: ids[2],
      invited: 4,
      attending: 4,
      late: 0,
      absent: 0,
      noReply: 0,
    },
  ],
};

const detail = {
  meetingId: "8a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6a1",
  title: "Weekly sync",
  startsAt: "2026-10-01T16:00:00.000Z",
  timezone: "Africa/Tunis",
  responseMode: "attendance",
  inviteeId: "9a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6a1",
  contactId: ids[0],
  fullName: "Amira B.",
  email: "a@uni.tn",
  emailStatus: "sent",
  answer: {
    status: "late",
    delayMinutes: 15,
    reason: "=HYPERLINK(1)",
    comment: "",
    afterDeadline: false,
    updatedAt: "2026-09-30T10:00:00.000Z",
  },
  mark: {
    actual: "absent",
    markedAt: "2026-10-01T16:10:00.000Z",
    markedByName: "Door Viewer",
    lateMinutes: null,
  },
};

function setup(data: object = summary) {
  routeFetch(
    new Proxy(
      {},
      {
        get: (_, key) => () =>
          new Response(
            JSON.stringify(
              String(key).includes("/attendance/details")
                ? { items: [detail], nextCursor: null }
                : data,
            ),
          ),
      },
    ),
  );
  const onOpen = vi.fn();
  renderWithProviders(
    <AttendanceView
      workspace={workspaceFixture}
      roster={roster}
      onOpenContact={onOpen}
    />,
  );
  return onOpen;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => setWideViewport(false));

describe("AttendanceView", () => {
  it("sorts by No reply first and opens a person", async () => {
    const onOpen = setup();
    expect(
      await screen.findByText("4 meetings in this period"),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("button", { name: /\./ });
    expect(rows[0]).toHaveTextContent("Omar D.");
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith(roster.contacts[1]);
  });

  it("narrows to a list", async () => {
    setup();
    await screen.findByText("4 meetings in this period");
    fireEvent.click(screen.getByRole("button", { name: /Design/ }));
    expect(screen.queryByText("Omar D.")).toBeNull();
    expect(screen.getByText("Amira B.")).toBeInTheDocument();
  });

  it("sorts by a column header on wide screens", async () => {
    setWideViewport(true);
    setup();
    const table = await screen.findByRole("table");
    const late = within(table).getByRole("button", { name: "Late" });
    fireEvent.click(late);
    expect(late.closest("th")).toHaveAttribute("aria-sort", "descending");
    const firstRow = within(table).getAllByRole("row")[1];
    expect(firstRow).toHaveTextContent("Amira B.");
  });

  it("exports the shown people as CSV, in the view's order", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("4 meetings in this period");
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "CSV" }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toMatch(/-attendance-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await blob.text()).split("\r\n");
    expect(lines.slice(0, 4)).toEqual([
      "Name,Email,Lists,Invited,Going,Late,Absent,No reply",
      "Omar D.,o@uni.tn,,4,0,0,1,3",
      "Amira B.,a@uni.tn,Design,4,1,3,0,0",
      "Youssef K.,y@uni.tn,Design,4,4,0,0,0",
    ]);
  });

  it("exports Summary and Details sheets as Excel", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("4 meetings in this period");
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Excel (.xlsx)" }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toMatch(/-attendance-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const sheets = await readXlsxFile(await blob.arrayBuffer());
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Summary", "Details"]);
    // A title band (title, subtitle, a gap) above the header (#257).
    const [title, subtitle] = sheets[0].data;
    expect(title[0]).toBe("Attendance · Summary");
    expect(subtitle[0]).toMatch(/ · Last 3 months · Exported /);
    expect(sheets[0].data).toHaveLength(7);
    expect(sheets[1].data[4]).toEqual([
      "Weekly sync",
      "2026-10-01 17:00",
      "Amira B.",
      "a@uni.tn",
      "Design",
      expect.stringContaining("15"),
      15,
      "=HYPERLINK(1)",
      null,
      "2026-09-30 11:00",
      null,
      "Sent",
      "Absent",
      "Door Viewer",
      null,
    ]);
    expect(sheets[1].data[3][9]).toBe("Answered at");
    expect(sheets[1].data[3].slice(-3)).toEqual([
      "Checked in",
      "Checked in by",
      "Was late by (min)",
    ]);
  });

  it("says there are no past meetings when the period is empty", async () => {
    setup({ meetings: 0, rows: [] });
    expect(
      await screen.findByText("No past meetings in this period."),
    ).toBeInTheDocument();
  });
});
