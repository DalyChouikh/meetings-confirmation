/** A JSON value, as the Sheets API takes it. */
export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };

/** One request of a Sheets `batchUpdate` (`{ updateCells: … }`, `{ addSheet: … }`, …). */
export type SheetsRequest = { [kind: string]: Json };
