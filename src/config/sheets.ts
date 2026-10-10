/**
 * Google Sheet limits and tuning (spec §8 "Google Sheet worker"). Measured values come from spike
 * S6 (`docs/spikes/S6.md`).
 */

/** Drive access to the files TapNShow creates only (non-sensitive; spec §9). */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** "Connect Google Sheets": `openid email` tell us which account's Drive holds the sheet. */
export const SHEETS_CONNECT_SCOPES = [
  "openid",
  "email",
  DRIVE_FILE_SCOPE,
] as const;

/** A Google Sheets file, as Drive `files.create` names it. */
export const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

/**
 * Rows per tab before a year splits at meeting boundaries. Measured in S6: about 1.6 MB and 5 s
 * per 2,000-row tab (about 820 bytes and 2.5 ms per row), under Google's recommended 2 MB payload
 * and a third of `SHEET_REQUEST_TIMEOUT_MS`.
 */
export const SHEET_TAB_ROWS_MAX = 2_000;

/** Google Drive Help: a spreadsheet holds 20 million cells; we stop at 19 million (paused `full`). */
export const SHEET_CELLS_MAX = 19_000_000;

/**
 * Sheets API limits: requests over 180 s time out; ours give up much earlier so the worker stays
 * inside its budget (S6: a full tab takes about a third of it).
 */
export const SHEET_REQUEST_TIMEOUT_MS = 15_000;

/** One run's time, inside the internal route's 60 s `maxDuration`. */
export const SHEET_BUDGET_MS = 50_000;

/** A Google request starts only with this much of the budget left (spec §8: at least 20 s). */
export const SHEET_MIN_LEFT_MS = SHEET_REQUEST_TIMEOUT_MS + 5_000;

/** Sheets leased per claim (`sheet_claim`'s `p_limit`). */
export const SHEET_CLAIM_BATCH = 5;

/**
 * Lease length: twice the internal route's `maxDuration`, so a run is always dead before its
 * lease can be taken over. Twin: `sheet_claim`'s caller passes it as `p_lease_seconds`.
 */
export const SHEET_LEASE_SECONDS = 120;

/** Raised when the tab formatting changes, so every tab is formatted again at its next redraw. */
export const SHEET_FORMAT_VERSION = 1;

/** How often Settings polls while a sheet is being created. */
export const SHEET_STATUS_POLL_MS = 3_000;
