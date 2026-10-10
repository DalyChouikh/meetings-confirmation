# TapNShow M7 (Google Sheet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Owner turns on a Google Sheet for a workspace with any Google account they pick. TapNShow creates a spreadsheet in that account's Drive and keeps it a live, one-way copy of every answer of every sent meeting that asks for answers: one tab per year in the Excel export look, a Meeting filter box, redrawn about a minute after any change. Problems pause it and the Owner is told in plain words. The M6 minors (#255) are fixed along the way.

**Architecture:** Supabase stays the source of truth. Statement-level triggers mark which **years** of a workspace's sheet changed (`sheet_dirty_years`). A second worker, started by the same per-minute wake-up as the Gmail dispatcher (one internal route, two independent workers), leases due sheets (`sheet_claim`). For each changed year it reads the rows in one set-based query, plans the tabs (split at meeting boundaries above `SHEET_TAB_ROWS_MAX`), skips tabs whose content hash did not change, and writes the rest with one `batchUpdate` each. The write sets values, plus hidden helper columns that drive conditional-format colours. A year is cleared only if its version did not change during the write, so a redraw is idempotent and never duplicates rows. The sheet has no outbox job. Pause reasons live on `sheet_syncs`, the only place the screens read. Google connections are revoked only once nothing uses them (no sender, no sheet). All Google calls use plain `fetch`, like Gmail.

**Tech Stack:**
- Next.js 16.3.8 (`after()`, `maxDuration`), React 19.2.8, TypeScript 5, bun 1.3.11.
- `@supabase/supabase-js` 2.117.2, Supabase CLI 2.119.0 (local ports 44320–44329), Postgres 17.
- `zod` 4, `@tanstack/react-query` 5.104, `next-intl` 4 (`createTranslator`), `date-fns` 4 + `@date-fns/tz` 1.5, `react-email` 6.11.
- Google Sheets API v4 and Drive API v3 over REST.
- Vitest 5, Playwright 1.63.
- **No new dependency.**

**Spec:** `docs/superpowers/specs/2026-10-04-tapnshow-design.md`. Read these sections before starting:
- §4: Google Sheet (M7).
- §5: diagram and outbox line.
- §6: `sheet_syncs`, `sheet_tabs`, `sheet_dirty_years`, `outbox_jobs`, Access pattern (M7).
- §7.3: the last line.
- §7.17.
- §8: Google Sheet worker (M7).
- §9: M7 flow, Disconnect, Sheets.
- §10: Sheets API (M7).
- §11: Account deletion, Google user data.
- §12: M7 tests.
- §13: S6.
- §14: M7 row.
- §15: Sheets API charges.

Design approved 2026-10-10 (#260). Epic #9; #255 folded in.

## Global Constraints

- **Earlier plans still apply.** Everything in the Global Constraints of the M0+M1, M2, M3, M4, M5 and M6 plans still applies:
  - free only; bun;
  - **no Server Actions** and no RSC data reads: every read and write goes through `src/app/api/**/route.ts` + TanStack Query;
  - no emojis anywhere (UI, emails, the sheet);
  - no `any` and no `unknown`: the ESLint rule bans the keyword, including `as unknown as`;
  - no `console.*`; JSDoc on every export; imports at the top of the file only;
  - no hardcoded values: limits go in `private.app_limits`, client tuning in `src/config/*`, and each client constant names its DB twin in its JSDoc;
  - SQL only in `supabase/migrations/*` and `src/server/queries/*`;
  - every UI, email and sheet string through next-intl (`messages/en.json`);
  - Soft Neobrutalism; Expressive motion with a reduced-motion fallback; WCAG 2.2 AA; ≥ 44 px tap targets;
  - one branch + PR per task with the repo template; CI green including `db`; squash merge; the commit trailer from the session's attribution reminder.
- **Owner rules (memories):**
  - no native form controls;
  - an "Are you sure?" dialog naming the consequence before Connect Google Sheets, Create a new sheet, Turn off the Google Sheet, and Disconnect;
  - **no technical text for users**: never "spreadsheet id", "scope", "token", "worker", "sync job", "API";
  - padded menus (`p-1.5`, `collisionPadding` 16); dialogs centred at 1024 px; chip rows use `CHIP_ROW_CLASS`.
- **DRY rules for M7 (owner emphasis 2026-10-10: "clean code, clean architecture, DRY; if something is unused, remove it and refactor"):**
  - **One row builder.** The sheet's rows come from `attendanceDetailRows` (`src/lib/export/rows.ts`). Its column list is `DETAIL_COLUMNS` (`src/lib/export/columns.ts`), shared with the Attendance Excel export. Words come from `exportWords(locale, messages)` (`src/lib/export/words.ts`), used by the browser hooks and the server worker. No hook or worker lists translation keys itself.
  - **One look.** Colours, font, header row count and column widths live in `src/lib/export/theme.ts`, used by `xlsx.ts` and by the Google request builder (`src/lib/sheets/requests.ts`). Tones come from `ANSWER_TONE` / `ACTUAL_TONE`.
  - **One Google OAuth module.** `src/server/google/gmail-oauth.ts` becomes `src/server/google/google-oauth.ts`, with names that do not say Gmail. The connect URL takes a `purpose` (`sending` | `sheets`), and both purposes share one connect route and one callback.
  - **One release rule.** `private.release_connection(connection)` is the only place that deletes a Google connection. It deletes only when `private.connection_in_use` is false, and it returns what the route needs to revoke the token. Disconnect, Turn off, Create a new sheet (replace) and workspace deletion all call it. One TS helper, `revokeReleased` (`src/server/google/release.ts`), revokes what it returns.
  - **One "is it due" rule per worker.**
    - `private.job_held(kind, invitee)` holds an update or cancel behind a queued invite. It is used by `dispatch_claim` (twice) and by the wake-up check, which fixes #255's every-minute wake.
    - `private.sheet_due(sheet_syncs)` is used by `sheet_claim` and by the wake-up check.
  - **One mark function.** `private.sheet_mark(workspaces uuid[], years integer[])` is the only writer of `sheet_dirty_years`. `private.sheet_year(starts_at, timezone)` is the only "which year" rule; its TS twin `sheetYear` (`src/lib/sheets/year.ts`) names it.
  - **One owner alert email.** `OwnerAlertEmail` (`src/emails/owner-alert-email.tsx`) replaces `SenderBrokenEmail` and also says "Your Google Sheet stopped updating".
  - **One wake-up.** `scheduleWorkers()` (`src/server/workers/schedule-workers.ts`) replaces `scheduleDispatch()`. It runs `runDispatch` and `runSheetSync` side by side with `Promise.allSettled`. `requireInternalSecret(request)` (`src/server/http/internal-secret.ts`) is the only Bearer check.
  - **Remove what is unused, in the task that makes it unused.** The outbox job kinds `sheet_sync`, `push` and `system_email` go in Task 3. `SenderBrokenEmail`, `scheduleDispatch`, `gmailConnectHref`, `senderSettingsPath` and `GmailConnectResult` / `GMAIL_CONNECT_ERRORS` are replaced by the shared versions and deleted, with every import updated in the same PR. A grep in each task's last step proves no reference is left.
- **Function security (spec §11):**
  - New organizer functions (`workspace_sheet`, `turn_off_sheet`, `retry_sheet`, and the reworked `disconnect_google_connection` / `delete_workspace`) are `private` definer bodies granted to `authenticated` behind `public` invoker wrappers. Each is added to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED` (sorted) in `src/server/db/function-security.db.test.ts` in the same PR.
  - Callback and worker functions (`start_sheet`, `google_connection_saved`, `sheet_claim`, `sheet_rows`, `sheet_save_file`, `sheet_save_tab`, `sheet_drop_tabs`, `sheet_finish_year`, `sheet_release`, `sheet_retry`, `sheet_pause`) are executable by `service_role` only.
  - Helpers (`sheet_year`, `sheet_mark`, `sheet_mark_all`, `sheet_due`, `job_held`, `connection_in_use`, `release_connection`, and every trigger function) are `revoke execute … from public, anon, authenticated`.
  - Run `supabase db advisors --local </dev/null` after every migration. Expected: no WARN or ERROR beyond the pre-existing `auth_leaked_password_protection`.
- **Changing an existing function:** copy the latest body from **the newest migration that defines it** and change only what the task says. Latest bodies at the start of M7:

| Function | Newest migration |
|---|---|
| `dispatch_claim` | `20261009235635_m6_edit_cancel.sql` |
| `dispatch_reserve` | `20261010154539_m6_update_calendar_unsubscribed.sql` |
| `dispatch_finish` | `20261009234223_m6_dispatch_kinds.sql` |
| `dispatch_retry` | `20261008182630_m5_calendar_dispatch.sql` |
| `kick_dispatcher`, `housekeeping` | `20261007205641_m4_outbox.sql` |
| `hit_user_rate_limit`, `token_submit_response`, `token_invitee`, `edit_sent_meeting`, `sync_reminder_timers(uuid, boolean)`, `meeting_results`, `delete_cancelled_meeting` | `20261009235635_m6_edit_cancel.sql` |
| `enqueue_reminders`, `fan_out_reminders`, `nudge_meeting` | `20261009234223_m6_dispatch_kinds.sql` |
| `mark_attendance`, `mark_rest_as_declared` | `20261010173301_m6_check_in_late_minutes.sql` |
| `save_google_connection` | `20261007174925_m4_save_connection_service_role.sql` |
| `workspace_sender`, `disconnect_google_connection` | `20261007173708_m4_sender.sql` |
| `delete_workspace` (body) | `20261006081823_m2_membership.sql` (moved to `private` by `20261006224354_m3_definer_wrappers.sql`) |

  A signature or return-type change is `drop function … (old args)` + `create function` + re-grant, because grants are per signature. After each M7 migration merges, the next task copies from **that** migration.
- **PostgREST resolves functions by argument names.** Pass SQL null with `sqlNullable()` (`src/server/db/rpc-args.ts`). A new optional argument needs `default null` in SQL.
- **New error codes.** Each goes in `API_ERROR_CODES`, `API_ERROR_STATUS` and `messages/en.json` `ApiErrors`, in plain words.
  - Task 6: `sheet_wrong_account` (409) "This sheet is in another Google account's Drive. Pick that account, or create a new sheet."
  - Task 13: `cancel_emails_waiting` (409) "The cancellation emails are waiting for Gmail. Reconnect Gmail, then delete the meeting once they've gone out."
- **New limits (`private.app_limits`):**
  - Task 6: `sheet_retries_per_user_per_hour` 20 and `google_connects_per_user_per_hour` 20.
  - Task 7: `sheet_quiet_seconds` 60, `sheet_max_wait_seconds` 300 and `sheet_retry_max_minutes` 30.
  - Task 14: `check_in_marks_per_user_per_hour` 3000 and `check_in_rests_per_user_per_hour` 60.
- **New client config:** `src/config/sheets.ts` (Task 5; values tuned by S6 in Task 1).
- **Env (Task 5):**
  - `GOOGLE_SHEETS_API_BASE_URL` (default `https://sheets.googleapis.com`) and `GOOGLE_DRIVE_API_BASE_URL` (default `https://www.googleapis.com`), the fakes' targets in e2e.
  - No new secret; the connect flow reuses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `NEXT_PUBLIC_GMAIL_CONNECT_ENABLED`, which now gates both purposes; its JSDoc says so.
- **Rollout order (binding, see Execution Order):**
  - The worker (Task 8) merges before the callback that creates the first `sheet_syncs` row (Task 9). Until then the triggers find no sheet and write nothing.
  - The Settings UI (Task 11) merges last.
  - There is no rollout flag. A workspace has a sheet only after its Owner connects one.
- **Sends during development:** fake Google (Gmail, Sheets, Drive) in tests and e2e. The production check (Task 15) uses the Owner's test workspace and the Owner's own Google account only. Never the club workspace without an explicit AskUserQuestion go-ahead in that session.
- **UI verification:**
  - Take Playwright screenshots through `.superpowers/scripts/screens/pw.config.ts` (`bun run test:e2e -c .superpowers/scripts/screens/pw.config.ts <spec>`; specs import `./shots`) at **390 px light, 320 px dark and 1024 px** for every new or changed screen and dialog.
  - Look at them before claiming done.
  - No horizontal page scroll at 320 px; dialogs centred at 1024 px.
  - `toBeVisible()` passes at opacity 0, so look at the image.
- **Local stack:**
  - `supabase start` (API 44321, DB 44322, Studio 44323, Mailpit 44324/44325). Run the CLI with `</dev/null`.
  - If `test:db` fails with a ZodError on `API_URL`, run `supabase stop </dev/null && supabase start </dev/null`.
  - The local DB is shared by every branch; `supabase db reset --local </dev/null` aligns it with the branch.
  - Run multi-statement SQL by hand with `psql postgresql://postgres:postgres@127.0.0.1:44322/postgres -v ON_ERROR_STOP=1 -f file`.
  - Stop any `next start`/`next dev` before `bun run test:e2e` (`ss -ltnp | grep :3000`, kill by PID; never `pkill -f`).
  - Regenerate types with `bun run db:types` after each migration.
  - Escape `[slug]`/`[id]`/`[token]` in vitest filters, or filter by a substring without brackets.
- **Before every commit, chained, never piped into `tail`:**
  - `bunx prettier --write <touched files, not .sql> && bun run format:check && bun run lint && bun run typecheck && bun run test`;
  - add `bun run test:db` for DB work (after `supabase db reset --local </dev/null`);
  - add `TZ=UTC bun run test:e2e` when a flow changes.
  - Scripted edits: assert the old text exists, and re-read the file after Prettier.
  - Run `typecheck` before trusting a green vitest run: duplicate object keys are TS1117, and vitest misses them.
- **Merging and hosted migrations (owner-approved):**
  - Open the PR, then run `bash .superpowers/scripts/merge-when-green.sh <pr>` with `run_in_background`.
  - Verify that `gh pr view <pr> --json state` is `MERGED`.
  - **Right after a PR with a migration merges, run `bash .superpowers/scripts/hosted-push.sh`** from the clean `origin/main` worktree `/tmp/tapnshow-main-wt` (recreate it with `git worktree add` if gone). Record the advisor output in the ledger.
  - Migrations land in timestamp order: Tasks 3 → 6 → 7 → 12 → 13 → 14 merge one after another. Create each migration file only when its task starts.
- **Rulings.** Every deviation from this plan becomes a ledger line `Task N: Ruling: <what> — <why> — <cost if wrong>` in `.superpowers/sdd/2026-10-10-m7-google-sheet/progress.md`.

## Review Focus

1. **A change lands while a tab is being written.** For example, someone answers while the worker writes 2026. Expected: the sheet ends up with that answer at most about two minutes later, never stuck on the older content, never with a row written twice.
   - Pinned in Task 7 (`sheet_finish_year` deletes the dirty row only when its `version` is the one claimed; a mark between claim and finish leaves it, and the next claim returns that year).
   - Pinned in Task 8 (the worker against a fake store whose version moves mid-write: a second run writes again, and both runs produce the same cell values).
2. **The Owner deletes a tab, renames it, or makes their own tab with the title "2026".** Expected:
   - the deleted tab comes back at the next redraw, and the Export link follows its new id;
   - the renamed tab gets its title back;
   - their own "2026" is never touched, and ours is named "2026 (TapNShow)".
   - Pinned in Task 4 (`resolveTitles`: collisions with sheets not in our list) and Task 8 (a metadata read without our `google_sheet_id` → `addSheet` with a new id and a forced write; a renamed id → `updateSheetProperties` with our title).
3. **Turning the sheet on for a workspace with years of history while Google answers 429.** Expected:
   - the newest year is written first;
   - the run stops cleanly when its budget ends and leaves the other years for later runs;
   - a 429 backs off (1, 2, 4… up to 30 minutes, with jitter) without pausing, and the Owner sees "Updating…" rather than an error.
   - Pinned in Task 8 (budget and `minLeftMs` before every request; `sheet_retry` on `retry`) and Task 7 (`sheet_retry` grows `retry_at` and caps it at `sheet_retry_max_minutes`).
4. **Google returns 403 for a reason that is not lost access**, such as a rate limit (Drive reports those as 403) or our project's API being disabled. Expected: the sheet is **not** paused and the Owner gets no email. It retries, and a disabled API raises a Sentry error for us.
   - Pinned in Task 5 (`classifyGoogleResponse` maps `rateLimitExceeded` / `userRateLimitExceeded` → `retry`, `accessNotConfigured` / `SERVICE_DISABLED` → `bug`, other 403 → `access_lost`, 404 → `not_found`, 400 → `bug`).
5. **The Owner reconnects with the wrong Google account, or unticks the Sheets box on Google's screen.** Expected:
   - wrong account: nothing changes and the Settings card says "This sheet is in <account>'s Drive. Pick that account, or create a new sheet.";
   - unticked box: nothing is saved for the sheet, and a sheet already on that account pauses with "TapNShow can no longer update the Google Sheet."
   - Pinned in Task 6 (`start_sheet` raises `sheet_wrong_account`; `google_connection_saved` pauses active sheets on a connection without `drive.file`) and Task 9 (callback: missing `drive.file` with `purpose=sheets` → `sheets_scope_denied`; a different `google_sub` → `sheet_wrong_account`).

---

## Execution Order

| Order | Task | Depends on |
|---|---|---|
| 0 | Merge #260 (spec) and this plan; create the agent-task issues (Tracking) | — |
| 1 | Task 1: Spike S6 against the Owner's test Google account (throwaway) | 0 |
| 2 | Task 2: Refactor: `google-oauth`, export words/columns/theme, Answered at in Details, `OwnerAlertEmail` | 0 |
| 3 | Task 3: DB: outbox job kinds rebuilt without `sheet_sync`, `push`, `system_email` | 0 |
| 4 | Task 4: Sheet layout library (pure TS): year, tabs, content, hash, requests, url | 1, 2 |
| 5 | Task 5: Google Sheets/Drive client, `src/config/sheets.ts`, env | 1 |
| 6 | Task 6: DB: `sheet_syncs`, `sheet_tabs`, `sheet_dirty_years`, RLS, status/turn-off/retry, release rule, `start_sheet`, `google_connection_saved`, `delete_workspace` | 3 |
| 7 | Task 7: DB: change triggers, worker functions, `sheet_due`, `job_held`, wake-up, housekeeping | 6 |
| 8 | Task 8: Worker (TS): `runSheetSync`, store, deps, `scheduleWorkers`, `requireInternalSecret`, pause alert | 4, 5, 7 |
| 9 | Task 9: Connect flow: `purpose=sheets`, replace, resume rule, Disconnect release, `GoogleConnectResult` | 6, 8 |
| 10 | Task 10: Sheet API routes, shared schemas, hooks | 9 |
| 11 | Task 11: UI: Settings > Sheets, Sending Disconnect, Home, Export menus | 10 |
| 12 | Task 12: #255: answers and reminders (time-back banner, same-audience hold, reconfirm reminder copy, reconfirm history + race) | 7 |
| 13 | Task 13: #255: edits, cancel, check-in (past reminders in Review, Cancel/Delete without Gmail, check-in total, superseded update, the "old" a person was told) | 12 |
| 14 | Task 14: #255: rate limits, `nudge_meeting` grant, EXPLAIN checks, two flakes, three JSDoc nits | 13 |
| 15 | Task 15: Rollout: e2e story with fake Google, final review, Owner's Google Cloud setup, production check, spec §14 evidence | 1–14 |

**Why this order:**
- Task 1 measures what Tasks 4 and 5 hard-code: tab size, timeout, slicer and conditional-format behaviour.
- Task 2 is a pure refactor with the existing tests as its safety net, so the new code builds on shared pieces from the start.
- Tasks 3 → 6 → 7 → 12 → 13 → 14 are a migration chain.
- Task 8 must merge before Task 9, because the callback creates the first `sheet_syncs` row.
- Task 11 depends on everything visible.
- The #255 tasks only touch M6 code, so they run after Task 7 in the migration chain without waiting for the UI.

## Tracking (once, after this plan merges)

- [ ] Create one `[task]` issue per Task 1–15 with the agent-task template, labels `type:task` + the area labels named in each task, and milestone `M7 Google Sheets sync`. Add each as a sub-issue of epic #9:
```bash
id=$(gh api repos/DalyChouikh/TapNShow/issues/<n> --jq .id)
gh api -X POST repos/DalyChouikh/TapNShow/issues/9/sub_issues -F sub_issue_id="$id"
```
  `gh issue create` once returned a GraphQL error without creating the issue. Check with `gh issue list --search "<title>"` before retrying.
- [ ] Rewrite epic #9's body: outcome, scope and completion criteria from spec §4/§14 (the old body says "rows updated in place"). Tick "Plan written for M7".
- [ ] #255 → Tasks 12–14: comment with the three task numbers; close #255 when Task 14 merges.
- [ ] Ledger: create `.superpowers/sdd/2026-10-10-m7-google-sheet/progress.md` with `bash ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/sdd-workspace docs/superpowers/plans/2026-10-10-m7-google-sheet.md`. One line per task and every `Ruling:`.
  - Per task: `task-start` / `task-done` (`…/executing-plans/scripts/`).
  - Run `task-done` only on an up-to-date `main`, after verifying the merge.
- [ ] **Design rulings (2026-10-10)**, copied into the ledger:
  - one-way copy (app → sheet);
  - the Owner picks any Google account;
  - one tab per calendar year, split at 10,000 rows (S6 tunes it);
  - a Meeting filter box (slicer), falling back to a heading row per meeting (layout C) if S6 fails;
  - every sent meeting that asks for answers, with cancelled ones kept and greyed;
  - the tab redrawn, not updated row by row;
  - pause and tell, never recreate behind the Owner's back;
  - Settings plus the Export menus (no Home card);
  - its own worker, no outbox job;
  - the unused outbox kinds removed;
  - connections released only once unused;
  - a platform email once per pause;
  - Answered at added to the Attendance Details export so the sheet and Excel share one column list.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `spikes/s6-sheets/*`, `docs/spikes/S6.md` | throwaway probe; results | 1 |
| `src/server/google/google-oauth.ts` (renamed from `gmail-oauth.ts`) | connect URL by purpose, code exchange, refresh, revoke | 2, 9 |
| `src/lib/export/words.ts`, `columns.ts`, `theme.ts` | translated export words, column lists, the shared look | 2 |
| `src/emails/owner-alert-email.tsx` | "needs reconnecting" / "stopped updating" | 2, 8 |
| `supabase/migrations/<ts>_m7_job_kinds.sql` | enum rebuild | 3 |
| `src/lib/sheets/year.ts`, `tabs.ts`, `content.ts`, `requests.ts`, `url.ts`, `types.ts` | pure sheet layout | 4 |
| `src/config/sheets.ts`, `src/server/google/sheets-client.ts` | limits; Sheets/Drive REST and error classification | 5 |
| `supabase/migrations/<ts>_m7_sheet_state.sql` | tables, RLS, status, turn off, retry, release, start, saved, delete_workspace | 6 |
| `supabase/migrations/<ts>_m7_sheet_worker.sql` | triggers, worker functions, `sheet_due`, `job_held`, `dispatch_claim`, wake-up, housekeeping | 7 |
| `src/server/queries/sheets.ts` | RPC wrappers (owner, callback, worker store) | 6, 8, 10 |
| `src/server/sheets/run-sheets.ts`, `sheets-deps.ts` | the worker | 8 |
| `src/server/workers/schedule-workers.ts`, `src/server/http/internal-secret.ts`, `src/app/api/internal/dispatch/route.ts` | one wake-up for both workers | 8 |
| `src/server/google/release.ts` | `revokeReleased` | 6, 9 |
| `src/app/api/integrations/google/connect/route.ts`, `callback/route.ts`, `connections/[id]/route.ts` | purposes, resume, release | 9 |
| `src/shared/api/sheets.ts`, `src/shared/api/google-connect.ts` | Zod schemas; connect result reasons | 9, 10 |
| `src/app/api/workspaces/[slug]/sheet/route.ts`, `sheet/retry/route.ts` | status, Turn off, Try again | 10 |
| `src/hooks/use-sheet.ts` | queries and mutations | 10 |
| `src/app/w/[slug]/settings/sheets-section.tsx`, `google-connect-result.tsx` | Settings > Sheets; connect result banner | 9, 11 |
| `src/components/forms/export-menu.tsx`, `src/app/w/[slug]/home-checklist.tsx`, `needs-attention.tsx`, `settings/sending-section.tsx` | links, Home, Disconnect copy | 11 |
| `supabase/migrations/<ts>_m7_minors_answers.sql`, `<ts>_m7_minors_edits.sql`, `<ts>_m7_minors_hardening.sql` | #255 | 12–14 |
| `e2e/helpers/fake-google.ts` (renamed from `fake-gmail.ts`), `e2e/m7-sheet.spec.ts` | the M7 story | 15 |

---
### Task 1: Spike S6: the Sheets API facts M7 relies on (throwaway)

**Labels:** `type:spike`, `area:infra`. **Owner involvement: required** (Google Cloud console, signing in, a second test account).

**Files:**
- Create: `spikes/s6-sheets/README.md`, `spikes/s6-sheets/auth.ts`, `spikes/s6-sheets/probe.ts`, `docs/spikes/S6.md`
- Modify: `docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§13 S6 result line), this plan (ledger rulings for any value that changes)

**Interfaces:**
- Produces: measured values written into Task 5's `src/config/sheets.ts`:
  - `SHEET_TAB_ROWS_MAX` (default 10,000);
  - `SHEET_REQUEST_TIMEOUT_MS` (default 15,000);
  - whether the slicer works (else layout C, see Step 7).
- Every later task reads `docs/spikes/S6.md`.

- [ ] **Step 1: Owner setup in Google Cloud (ask the Owner; give exact clicks, never ask for secrets in chat)**

Send the Owner this checklist (AskUserQuestion "Done" / "Stuck at step N"):
1. Open console.cloud.google.com, project `tapnshow`, then APIs & Services → Library. Enable **Google Sheets API** and **Google Drive API**.
2. Go to Google Auth Platform → Data Access → Add or remove scopes. Tick `…/auth/drive.file` ("See, edit, create and delete only the specific Google Drive files you use with this app"), then Save. It should appear under "Your non-sensitive scopes".
3. Go to Billing. Say whether project `tapnshow` shows "This project has no billing account" (spec §15 needs the answer).
4. Have a second Google account ready that you can sign in to in a private window (view-only test).

- [ ] **Step 2: Write `spikes/s6-sheets/auth.ts`**

This is a loopback OAuth helper on the registered `http://localhost:3000/api/integrations/google/callback`. Stop `next dev` first. It reads the client id/secret from `.env.local` without printing them, and stores the refresh token in `~/.config/tapnshow/s6-token` (chmod 600).

```ts
import { createServer } from "node:http";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";

const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
if (!clientId || !clientSecret) {
  throw new Error("Run with: bun --env-file=.env.local spikes/s6-sheets/auth.ts");
}
const redirect = "http://localhost:3000/api/integrations/google/callback";
const verifier = randomBytes(32).toString("base64url");
const state = randomBytes(16).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirect,
  response_type: "code",
  scope: "openid email https://www.googleapis.com/auth/drive.file",
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
  access_type: "offline",
  prompt: "consent select_account",
  include_granted_scopes: "true",
}).toString();
process.stdout.write(`Open this URL in the browser:\n${url.toString()}\n`);

const server = createServer(async (request, response) => {
  const query = new URL(request.url ?? "/", "http://localhost:3000").searchParams;
  if (query.get("state") !== state || !query.get("code")) {
    response.end("State mismatch or no code.");
    return;
  }
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: query.get("code") ?? "",
      code_verifier: verifier,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
    }).toString(),
  });
  const body = (await token.json()) as { refresh_token?: string; scope?: string };
  const dir = join(homedir(), ".config", "tapnshow");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "s6-token");
  writeFileSync(file, body.refresh_token ?? "");
  chmodSync(file, 0o600);
  process.stdout.write(`Granted scopes: ${body.scope ?? "(none)"}\nRefresh token saved: ${Boolean(body.refresh_token)}\n`);
  response.end("Done. You can close this tab.");
  server.close();
});
server.listen(3000, "127.0.0.1");
```

- [ ] **Step 3: Write `spikes/s6-sheets/probe.ts`**

The probe runs each experiment and prints **only** measurements and booleans, never names or emails. The data is synthetic ("Person 1"…).

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const refresh = readFileSync(join(homedir(), ".config", "tapnshow", "s6-token"), "utf8");
const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  }).toString(),
});
const { access_token: token } = (await tokenResponse.json()) as { access_token: string };
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const log = (label: string, value: string | number | boolean) =>
  process.stdout.write(`${label}: ${value}\n`);

async function call(method: string, url: string, body?: object) {
  const started = performance.now();
  const response = await fetch(url, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, ms: Math.round(performance.now() - started), text };
}

// 1. Drive files.create of a spreadsheet with appProperties, then files.list by appProperties.
const key = crypto.randomUUID();
const created = await call("POST", "https://www.googleapis.com/drive/v3/files?fields=id", {
  name: "S6 probe",
  mimeType: "application/vnd.google-apps.spreadsheet",
  appProperties: { tapnshow_create_key: key },
});
log("files.create status", created.status);
const id = (JSON.parse(created.text) as { id: string }).id;
const listed = await call(
  "GET",
  `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`appProperties has { key='tapnshow_create_key' and value='${key}' } and trashed = false`)}&fields=files(id)`,
);
log("files.list by appProperties finds it", listed.text.includes(id));

// 2. Tab, frozen rows, hidden helper columns, conditional formats on open-ended ranges, slicer.
const meta = await call("GET", `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets(properties(sheetId,title))`);
const sheetId = (JSON.parse(meta.text) as { sheets: { properties: { sheetId: number } }[] }).sheets[0].properties.sheetId;
const fmt = await call("POST", `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
  requests: [
    { updateSheetProperties: { properties: { sheetId, title: "2026", gridProperties: { rowCount: 10, columnCount: 18, frozenRowCount: 4 } }, fields: "title,gridProperties(rowCount,columnCount,frozenRowCount)" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 15, endIndex: 18 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
    { addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId, startRowIndex: 4, startColumnIndex: 5, endColumnIndex: 6 }], booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: '=$Q5="success"' }] }, format: { backgroundColor: { red: 0.73, green: 0.97, blue: 0.82 } } } } } },
    { addConditionalFormatRule: { index: 1, rule: { ranges: [{ sheetId, startRowIndex: 4, startColumnIndex: 0, endColumnIndex: 15 }], booleanRule: { condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: '=$P5="odd"' }] }, format: { backgroundColor: { red: 0.95, green: 0.93, blue: 1 } } } } } },
    { addSlicer: { slicer: { spec: { dataRange: { sheetId, startRowIndex: 3, startColumnIndex: 0, endColumnIndex: 15 }, columnIndex: 0, title: "Meeting", applyToPivotTables: false }, position: { overlayPosition: { anchorCell: { sheetId, rowIndex: 2, columnIndex: 0 }, widthPixels: 240, heightPixels: 30 } } } } },
  ],
});
log("format batchUpdate status", fmt.status);
if (fmt.status !== 200) log("format error", fmt.text.slice(0, 300));

// 3. Values: grow from 10 rows to 25 (rows written after the rules), text that looks like formulas.
const rows = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    values: [
      { userEnteredValue: { stringValue: `Meeting ${Math.floor((from + i) / 5)} · Thu 15 Oct` } },
      ...Array.from({ length: 4 }, () => ({ userEnteredValue: { stringValue: "x" } })),
      { userEnteredValue: { stringValue: i === 0 ? "=1+1" : i === 1 ? "+33 6" : i === 2 ? "'quoted" : "Going" } },
      ...Array.from({ length: 9 }, () => ({ userEnteredValue: { stringValue: "y" } })),
      { userEnteredValue: { stringValue: (from + i) % 2 ? "odd" : "even" } },
      { userEnteredValue: { stringValue: "success" } },
      { userEnteredValue: { stringValue: "" } },
    ],
  }));
const grow = await call("POST", `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
  requests: [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: 29 } }, fields: "gridProperties.rowCount" } },
    { updateCells: { start: { sheetId, rowIndex: 4, columnIndex: 0 }, rows: rows(25), fields: "userEnteredValue" } },
  ],
});
log("grow status", grow.status);
const read = await call("GET", `https://sheets.googleapis.com/v4/spreadsheets/${id}?ranges=2026!F5:F7&includeGridData=true&fields=sheets(data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))),conditionalFormats,slicers(spec(dataRange)))`);
log("formula-looking text kept as text (inspect)", read.text.includes("=1+1"));
log("plus and quote kept (inspect)", read.text.includes("+33 6") && read.text.includes("'quoted"));
log("rule colour applied to a row written later (inspect effectiveFormat)", read.text.includes("0.73"));
log("slicer dataRange after growth", read.text.match(/"dataRange":\{[^}]*\}/)?.[0] ?? "none");

// 4. Size and time: 10,000 and 20,000 rows of realistic width.
for (const n of [10_000, 20_000]) {
  const body = {
    requests: [
      { updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: n + 4 } }, fields: "gridProperties.rowCount" } },
      { updateCells: { start: { sheetId, rowIndex: 4, columnIndex: 0 }, rows: rows(n), fields: "userEnteredValue" } },
    ],
  };
  const bytes = JSON.stringify(body).length;
  const result = await call("POST", `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, body);
  log(`rows ${n}: bytes`, bytes);
  log(`rows ${n}: status / ms`, `${result.status} / ${result.ms}`);
}

// 5. Trash: does a write still work, and what does files.get say?
await call("PATCH", `https://www.googleapis.com/drive/v3/files/${id}`, { trashed: true });
const trashedWrite = await call("POST", `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
  requests: [{ updateCells: { start: { sheetId, rowIndex: 4, columnIndex: 1 }, rows: rows(1), fields: "userEnteredValue" } }],
});
log("write to trashed file status", trashedWrite.status);
const trashedGet = await call("GET", `https://www.googleapis.com/drive/v3/files/${id}?fields=trashed`);
log("files.get trashed", trashedGet.text);
await call("PATCH", `https://www.googleapis.com/drive/v3/files/${id}`, { trashed: false });

// 6. 404 after a permanent delete, on Sheets and Drive.
const second = await call("POST", "https://www.googleapis.com/drive/v3/files?fields=id", {
  name: "S6 probe delete",
  mimeType: "application/vnd.google-apps.spreadsheet",
});
const secondId = (JSON.parse(second.text) as { id: string }).id;
await call("DELETE", `https://www.googleapis.com/drive/v3/files/${secondId}`);
log("sheets after delete", (await call("GET", `https://sheets.googleapis.com/v4/spreadsheets/${secondId}?fields=spreadsheetId`)).status);
log("drive after delete", (await call("GET", `https://www.googleapis.com/drive/v3/files/${secondId}?fields=trashed`)).status);
log("spreadsheet for the manual checks", `https://docs.google.com/spreadsheets/d/${id}/edit`);
```

- [ ] **Step 4: Run it with the Owner**

1. `bun --env-file=.env.local spikes/s6-sheets/auth.ts`. Give the Owner the printed URL as a `! open` line, or ask them to paste it in their browser.
2. They sign in with their **test** account, and screenshot Google's consent screen so its exact wording goes into the spec.
3. Run `bun --env-file=.env.local spikes/s6-sheets/probe.ts`.
4. Record every printed line in `docs/spikes/S6.md`.

- [ ] **Step 5: Manual checks with the Owner (the probe spreadsheet link it printed)**

1. As the test account: open the link, pick one meeting in the Meeting filter box, and check that only its rows show.
2. Share it **view-only** with the second account. Open it there in a private window, use the filter box, and check that rows hide for that viewer only, while the first window still shows every row.
3. In the first window, rename the tab, delete a row, then type `=1+1` into a cell. These show what a redraw must repair; nothing is recorded but what happened.

- [ ] **Step 6: Clean up and write the result**

1. Delete the probe spreadsheet from the test Drive.
2. Revoke the probe token at myaccount.google.com/permissions (the Owner), then delete `~/.config/tapnshow/s6-token`.
3. Write `docs/spikes/S6.md` with three sections: Question / Method / Results (the printed numbers) / Decision. In the Decision, set `SHEET_TAB_ROWS_MAX` to the largest of 10,000 / 5,000 whose payload is ≤ 2 MB and whose time is ≤ half of `SHEET_REQUEST_TIMEOUT_MS`, and keep the timeout at 15,000 unless the measured time needs more (cap 25,000).
4. Add a §13 line "**S6 — <PASS|FAIL> (date).** …" to the spec.
5. Open a Decision issue with the evidence and close it.

- [ ] **Step 7: If the slicer fails (rows don't hide on the same tab, or a viewer's choice changes everyone's view)**

Stop and AskUserQuestion: "The filter box doesn't work as Google's help page says (<what failed>). Switch to layout C (a dark heading row per meeting, rows folded under it)?" — options "Switch to C (Recommended)", "Keep B without the filter box". Record the answer as a ruling. Layout C changes **only** Task 4 (`content.ts` adds a heading row per meeting with the counts; `requests.ts` adds `addDimensionGroup` per meeting instead of `addSlicer`). Write that amendment into this plan before Task 4 starts.

- [ ] **Step 8: Commit and PR**

```bash
git checkout -b spike/m7-s6-sheets
git add spikes/s6-sheets docs/spikes/S6.md docs/superpowers/specs/2026-10-04-tapnshow-design.md
git commit -m "docs: spike S6 (Sheets API facts for M7)"
```
PR "docs: spike S6 (Sheets API facts for M7)", `Part of #9`, then `merge-when-green.sh`.

---

### Task 2: Refactor: one Google OAuth module, shared export words, columns and look, one owner alert email

**Labels:** `type:task`, `area:api`, `area:email`, `area:frontend`. No behaviour change except **Answered at** in the Attendance Details export (owner ruling, so the sheet and Excel share one column list).

**Files:**
- Rename: `src/server/google/gmail-oauth.ts` → `src/server/google/google-oauth.ts` (+ its test)
- Create: `src/lib/export/words.ts`, `src/lib/export/words.test.ts`, `src/lib/export/columns.ts`, `src/lib/export/theme.ts`, `src/lib/export/theme.test.ts`, `src/emails/owner-alert-email.tsx`, `src/emails/owner-alert-email.test.tsx`
- Modify: `src/lib/export/xlsx.ts`, `src/lib/export/rows.ts`, `src/lib/export/rows.test.ts`, `src/hooks/use-answer-labels.ts`, `src/app/w/[slug]/lists/use-export-attendance.ts`, `src/app/w/[slug]/meetings/[id]/use-export-answers.ts`, `src/server/dispatch/dispatch-deps.ts`, `src/server/dispatch/run-dispatch.ts`, `src/server/dispatch/run-dispatch.test.ts`, the three `src/app/api/integrations/google/**/route.ts` and their tests, `messages/en.json`
- Delete: `src/emails/sender-broken-email.tsx`, `src/emails/sender-broken-email.test.tsx`

**Interfaces:**
- Produces (used by Tasks 4, 8, 9):
  - `google-oauth.ts` exports `createGoogleConnectAuthorization`, `GoogleConnectState`, `encodeConnectCookie`, `decodeConnectCookie`, `exchangeGoogleCode`, `GoogleConnectGrant`, `IdTokenClaims`, `decodeIdTokenClaims`, `refreshGoogleAccessToken`, `RefreshResult`, `revokeGoogleToken`. Task 9 adds `purpose`.
  - `exportWords(locale: Locale, messages: AppMessages): ExportWords` with `ExportWords = { labels: AnswerLabels; text: ExportText; column: (key: ExportColumnKey) => string; t: ExportTranslator }`.
  - `type AppMessages = typeof messages` (from `messages/en.json`).
  - `DETAIL_COLUMNS`, `ANSWER_COLUMNS`, `SUMMARY_COLUMNS`: `ReadonlyArray<ExportColumn>`, with `ExportColumn = { key: ExportColumnKey; width: number; tone?: FillTone }`.
  - `EXPORT_COLORS`, `EXPORT_FONT_FAMILY`, `EXPORT_FONT_SIZE`, `EXPORT_HEADER_ROWS`, `fittedWidth(header: string, values: (string | number | null)[], min: number): number`.
  - `attendanceDetailRows(details, listNames, labels, text, options?: { meetingCell?: (row: AttendanceDetailRow) => string })`, now with Answered at after Comment.
  - `renderOwnerAlertEmail(props: OwnerAlertEmailProps)`, with `OwnerAlertEmailProps = { kind: "senderBroken" | "sheetPaused"; workspaceName: string; settingsUrl: string; reason?: SheetPauseReason }`.

- [ ] **Step 1: Rename the OAuth module (mechanical)**

```bash
git checkout -b refactor/m7-shared-pieces
git mv src/server/google/gmail-oauth.ts src/server/google/google-oauth.ts
git mv src/server/google/gmail-oauth.test.ts src/server/google/google-oauth.test.ts
```

In `google-oauth.ts`, rename the following (the bodies stay unchanged; the JSDoc of `createGoogleConnectAuthorization` says "Google's authorization URL for a Google connection (spec §9)"):

| Old name | New name |
|---|---|
| `GmailConnectState` | `GoogleConnectState` |
| `createGmailConnectAuthorization` | `createGoogleConnectAuthorization` |
| `GmailConnectGrant` | `GoogleConnectGrant` |
| `exchangeGmailCode` | `exchangeGoogleCode` |

Then update every import:

```bash
grep -rln "gmail-oauth\|GmailConnectState\|createGmailConnectAuthorization\|GmailConnectGrant\|exchangeGmailCode" src e2e
```
Edit each listed file (routes, their tests, `dispatch-deps.ts`, `run-dispatch.ts`, `run-dispatch.test.ts`), then run `bun run typecheck`.
Expected: no errors. Then run `grep -rn "gmail-oauth\|GmailConnect\|exchangeGmailCode" src e2e`. Expected: no output.

- [ ] **Step 2: Write the failing test for `exportWords`**

`src/lib/export/words.test.ts`:
```ts
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun run test src/lib/export/words.test.ts`
Expected: FAIL with "Failed to resolve import "./words"".

- [ ] **Step 4: Write `src/lib/export/columns.ts` and `src/lib/export/words.ts`**

```ts
// columns.ts
import type { FillTone } from "@/design/tokens";
import type messages from "../../../messages/en.json";

/** A column header key under `Export.columns`. */
export type ExportColumnKey = keyof (typeof messages)["Export"]["columns"];

/** One export column: its header key, its minimum width in characters, an optional header tone. */
export type ExportColumn = { key: ExportColumnKey; width: number; tone?: FillTone };

/** Meeting answers (`meetingAnswerRows`), the meeting page's export. */
export const ANSWER_COLUMNS: ReadonlyArray<ExportColumn> = [
  { key: "name", width: 24 },
  { key: "email", width: 30 },
  { key: "lists", width: 20 },
  { key: "answer", width: 18 },
  { key: "lateBy", width: 12 },
  { key: "reason", width: 40 },
  { key: "comment", width: 40 },
  { key: "answeredAt", width: 18 },
  { key: "afterDeadline", width: 16 },
  { key: "emailStatus", width: 16 },
  { key: "checkedIn", width: 14 },
  { key: "checkedInBy", width: 24 },
  { key: "wasLateBy", width: 14 },
];

/** Attendance summary (`attendanceSummaryRows`). */
export const SUMMARY_COLUMNS: ReadonlyArray<ExportColumn> = [
  { key: "name", width: 24 },
  { key: "email", width: 30 },
  { key: "lists", width: 20 },
  { key: "invited", width: 10 },
  { key: "attending", width: 10, tone: "success" },
  { key: "late", width: 10, tone: "warning" },
  { key: "absent", width: 10, tone: "danger" },
  { key: "noReply", width: 10, tone: "neutral" },
];

/**
 * One row per person per meeting (`attendanceDetailRows`): the Attendance Details sheet and every
 * Google Sheet tab (spec §7.17), so both always have the same columns.
 */
export const DETAIL_COLUMNS: ReadonlyArray<ExportColumn> = [
  { key: "meeting", width: 30 },
  { key: "date", width: 18 },
  ...ANSWER_COLUMNS,
];
```

`DETAIL_COLUMNS` = Meeting, Date + the 13 answer columns. That is 15 columns, the spec §7.17 list.

```ts
// words.ts
import { createTranslator } from "next-intl";
import type { Locale } from "@/config/i18n";
import type { AnswerLabels } from "@/lib/responses/describe-answer";
import type messages from "../../../messages/en.json";
import type { ExportColumnKey } from "./columns";
import type { ExportText } from "./rows";

/** The app's message catalogue type (every locale has the same shape). */
export type AppMessages = typeof messages;

/** The `Export` namespace translator (sheet titles and bands use it too). */
export type ExportTranslator = ReturnType<typeof createTranslator<AppMessages, "Export">>;

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
export function exportWords(locale: Locale, catalogue: AppMessages): ExportWords {
  const t = createTranslator({ locale, messages: catalogue, namespace: "Export" });
  const answer = createTranslator({ locale, messages: catalogue, namespace: "AnswerPage.answer" });
  const status = createTranslator({ locale, messages: catalogue, namespace: "MeetingPage.status" });
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
```

If `createTranslator<AppMessages, "Export">` doesn't type-check as a generic call in a type position, derive `ExportTranslator` from a local `function exportTranslator(…) { return createTranslator(…) }` with `ReturnType<typeof exportTranslator>`. Record it as a ruling only if neither works.

- [ ] **Step 5: Run the test**

Run: `bun run test src/lib/export/words.test.ts`
Expected: PASS.

- [ ] **Step 6: Use `exportWords` everywhere the words were listed**

`src/hooks/use-answer-labels.ts`:
```ts
"use client";

import { useLocale, useMessages } from "next-intl";
import { resolveLocale } from "@/config/i18n";
import { exportWords } from "@/lib/export/words";
import type { AnswerLabels } from "@/lib/responses/describe-answer";

/** `AnswerLabels` from the current messages (answer page, meeting page, history). */
export function useAnswerLabels(): AnswerLabels {
  return exportWords(resolveLocale(useLocale()), useMessages()).labels;
}

/** Every export word from the current messages (the export hooks). */
export function useExportWords() {
  return exportWords(resolveLocale(useLocale()), useMessages());
}
```

If `useMessages()` isn't assignable to `AppMessages` (next-intl's `AppConfig.Messages` is `typeof messages`, so it should be), stop and fix the typing. Never cast.

In `use-export-attendance.ts` and `use-export-answers.ts`:
- replace `useTranslations("Export")`, `useTranslations("MeetingPage.status")` and `useAnswerLabels()` with `const words = useExportWords();`;
- build headers with `columns.map((c) => ({ header: words.column(c.key), width: c.width, tone: c.tone }))` from `SUMMARY_COLUMNS` / `DETAIL_COLUMNS` / `ANSWER_COLUMNS`;
- pass `words.labels, words.text` to the row builders;
- use `words.t(...)` for titles and bands.

Delete the local `SUMMARY`, `DETAILS`, `WIDTHS` and `COLUMNS` constants and the two inline `ExportText` objects.

- [ ] **Step 7: Write the failing test for Answered at in Details and the meeting-cell option**

Add to `src/lib/export/rows.test.ts` (reuse that file's existing detail-row fixture and the words from `exportWords("en", messages)`):
```ts
it("puts Answered at (meeting zone) after Comment, like the meeting export", () => {
  const [row] = attendanceDetailRows([detail], new Map(), words.labels, words.text);
  expect(row).toHaveLength(15);
  expect(row[8]).toBe(detail.answer?.comment ?? "");
  expect(row[9]).toBe("2026-10-08 19:05");
});

it("lets the Google Sheet name the meeting cell its own way", () => {
  const [row] = attendanceDetailRows([detail], new Map(), words.labels, words.text, {
    meetingCell: () => "Weekly sync · Thu 8 Oct",
  });
  expect(row[0]).toBe("Weekly sync · Thu 8 Oct");
});
```

Set the fixture's `answer.updatedAt` to `"2026-10-08T18:05:00.000Z"` and `timezone` to `"Africa/Tunis"` (UTC+1), which gives 19:05.

- [ ] **Step 8: Run it to verify it fails**

Run: `bun run test src/lib/export/rows.test.ts`
Expected: FAIL. `toHaveLength(15)` fails because the row has 14 cells.

- [ ] **Step 9: Change `attendanceDetailRows`**

```ts
/**
 * Attendance details and Google Sheet rows (`DETAIL_COLUMNS`): Meeting, Date (meeting zone), Name,
 * Email, Lists, Answer, Late by (min), Reason, Comment, Answered at (meeting zone), After the
 * deadline, Email, Checked in, Checked in by, Was late by (min). `meetingCell` replaces the plain
 * title (the sheet adds the date so repeated titles stay apart).
 */
export function attendanceDetailRows(
  details: AttendanceDetailRow[],
  listNames: Map<string, string[]>,
  labels: AnswerLabels,
  text: ExportText,
  options: { meetingCell?: (row: AttendanceDetailRow) => string } = {},
): ExportCell[][] {
  return details.map((row) => [
    options.meetingCell ? options.meetingCell(row) : row.title,
    at(row.startsAt, row.timezone),
    row.fullName,
    row.email,
    (listNames.get(row.contactId) ?? []).join(", "),
    answerText(labels, text, row.answer, row.emailStatus),
    row.answer?.delayMinutes ?? null,
    row.answer?.reason ?? "",
    row.answer?.comment ?? "",
    row.answer ? at(row.answer.updatedAt, row.timezone) : "",
    row.answer?.afterDeadline ? text.yes : "",
    text.emailStatus(row.emailStatus),
    ...checkInCells(text, row.mark),
  ]);
}
```

Fix any other `rows.test.ts` expectation that counted 14 cells (update the expected arrays; don't delete assertions).

- [ ] **Step 10: Write the failing test for the shared look**

`src/lib/export/theme.test.ts`:
```ts
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
```

The arithmetic matches `xlsx.ts` today: `max(min, ceil(header × 1.25) + 3, ceil(longest × 1.1) + 2)`, capped at 60. For example, "Was late by (min)" has 17 characters, so ceil(21.25) + 3 = 25, and 27 characters give ceil(29.7) + 2 = 32.

- [ ] **Step 11: Run it to verify it fails, then write `theme.ts` and use it in `xlsx.ts`**

Run: `bun run test src/lib/export/theme.test.ts`
Expected: FAIL with "Failed to resolve import "./theme"".

```ts
// theme.ts
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
  const longest = Math.max(0, ...values.map((value) => String(value ?? "").length));
  return Math.min(
    WIDTH_MAX,
    Math.max(min, Math.ceil(header.length * 1.25) + 3, Math.ceil(longest * 1.1) + 2),
  );
}
```

In `xlsx.ts`:
- `const COLORS = EXPORT_COLORS`;
- `FONT = { fontFamily: EXPORT_FONT_FAMILY, fontSize: EXPORT_FONT_SIZE }`;
- `stickyRowsCount: EXPORT_HEADER_ROWS`;
- `columnWidth(sheet, index)` becomes `fittedWidth(column.header, sheet.rows.map((row) => cellText(row[index]) ?? null), column.width)`;
- delete `HEADER_ROWS`, `WIDTH_MAX` and the old body.

Run: `bun run test src/lib/export`
Expected: PASS (the existing `xlsx.test.ts` proves the look didn't change).

- [ ] **Step 12: Write the failing test for `OwnerAlertEmail`**

`src/emails/owner-alert-email.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { renderOwnerAlertEmail } from "./owner-alert-email";

describe("renderOwnerAlertEmail", () => {
  it("keeps the sender-broken wording", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "senderBroken",
      workspaceName: "GDG ISSAT",
      settingsUrl: "https://tapnshow.vercel.app/w/gdg/settings#sending",
    });
    expect(email.subject).toBe("Gmail sending for GDG ISSAT needs reconnecting");
    expect(email.text).toContain("Reconnect Gmail");
  });

  it("says the Google Sheet stopped updating, with the reason in plain words", async () => {
    const email = await renderOwnerAlertEmail({
      kind: "sheetPaused",
      reason: "trashed",
      workspaceName: "GDG ISSAT",
      settingsUrl: "https://tapnshow.vercel.app/w/gdg/settings#sheets",
    });
    expect(email.subject).toBe("The Google Sheet of GDG ISSAT stopped updating");
    expect(email.text).toContain("moved to the trash");
    expect(email.text).toContain("Open Settings");
    expect(email.html).not.toMatch(/token|scope|API/i);
  });
});
```

- [ ] **Step 13: Run it to verify it fails, then write the email and its messages**

Run: `bun run test src/emails/owner-alert-email.test.tsx`
Expected: FAIL with "Failed to resolve import "./owner-alert-email"".

Add to `messages/en.json` under `Email` (keep `senderBroken` as is):
```json
"sheetPaused": {
  "subject": "The Google Sheet of {workspace} stopped updating",
  "preview": "Answers still arrive in {appName}; the Google Sheet waits for you.",
  "heading": "The Google Sheet of {workspace} stopped updating",
  "body": {
    "trashed": "The Google Sheet was moved to the trash. Restore it from Google Drive, then tap Try again in Settings. Or create a new one.",
    "deleted": "The Google Sheet was deleted. You can create a new one in Settings.",
    "access_lost": "{appName} can no longer update the Google Sheet, for example after a password change or if access was removed. Reconnect Google in Settings.",
    "full": "The Google Sheet is full. You can create a new one in Settings."
  },
  "button": "Open Settings",
  "fallback": "If the button doesn't work, copy this link:"
}
```

`src/emails/owner-alert-email.tsx`: copy `SenderBrokenEmail`'s JSX and `render…` function, and choose the namespace by `kind`:
- `senderBroken` uses `senderBroken.*`;
- `sheetPaused` uses `sheetPaused.*`, with `sheetPaused.body.<reason>`.

Export:
```ts
/** Why a Google Sheet paused (spec §7.17); twin: `public.sheet_pause_reason`. */
export type SheetPauseReason = "trashed" | "deleted" | "access_lost" | "full";

/** What an alert to a workspace Owner needs (sent by the platform sender, spec §8). */
export type OwnerAlertEmailProps =
  | { kind: "senderBroken"; workspaceName: string; settingsUrl: string }
  | { kind: "sheetPaused"; reason: SheetPauseReason; workspaceName: string; settingsUrl: string };
```

Then:
- in `dispatch-deps.ts`, `alertBroken` calls `renderOwnerAlertEmail({ kind: "senderBroken", … })`;
- delete `sender-broken-email.tsx` and its test, and move that test's assertions into the new test file if any are not covered;
- run `grep -rn "sender-broken-email\|SenderBrokenEmail\|renderSenderBrokenEmail" src`. Expected: no output.

- [ ] **Step 14: Full check, commit, PR**

Run: `bunx prettier --write <touched files> && bun run format:check && bun run lint && bun run typecheck && bun run test`
Expected: all pass.

```bash
git add -A src messages
git commit -m "refactor: shared Google OAuth, export words, columns and look; one owner alert email"
```
PR "refactor: shared pieces for the Google Sheet (M7)", with `Closes #<task issue>` and labels `type:task`, `area:api`, `area:email`, `area:frontend`. Notes: "Only behaviour change: Answered at in the Attendance Details export (owner ruling 2026-10-10)." Then `merge-when-green.sh`.

---

### Task 3: DB: outbox job kinds without the unused `sheet_sync`, `push`, `system_email`

**Labels:** `type:task`, `area:db`, `area:pipeline`.

**Files:**
- Create: `supabase/migrations/<ts>_m7_job_kinds.sql` (`supabase migration new m7_job_kinds`), `src/server/db/job-kinds.db.test.ts`
- Modify: `src/server/queries/dispatch.test.ts` (it uses `system_email` as the unreadable kind), `src/server/db/database.types.ts` (regenerated), spec §6 is already updated by #260

**Interfaces:**
- Produces: `public.job_kind` = `invite | calendar_confirm | update | cancel | reminder`. The TS `jobKindSchema` (`src/server/queries/dispatch.ts`) already lists exactly these five; its JSDoc now names the enum as its twin.

- [ ] **Step 1: Write the failing DB test**

`src/server/db/job-kinds.db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryLocalSql } from "@/test/db/sql";

describe("outbox job kinds (spec §6)", () => {
  it("are exactly the five the dispatcher sends", () => {
    const rows = queryLocalSql(
      "select e.enumlabel as label from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid where t.typname = 'job_kind' and t.typnamespace = 'public'::regnamespace order by e.enumsortorder",
      z.array(z.object({ label: z.string() })),
    );
    expect(rows.map((row) => row.label)).toEqual([
      "invite",
      "calendar_confirm",
      "update",
      "cancel",
      "reminder",
    ]);
  });

  it("keeps the due-timer index the reminder fan-out reads", () => {
    const rows = queryLocalSql(
      "select indexdef as def from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'outbox_jobs_due_timers_idx'",
      z.array(z.object({ def: z.string() })).length(1),
    );
    expect(rows[0].def).toContain("WHERE ((kind = 'reminder'::job_kind) AND (invitee_id IS NULL) AND (status = 'pending'::job_status))");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:db src/server/db/job-kinds.db.test.ts`
Expected: FAIL. The first test receives the eight labels, including `sheet_sync`, `push` and `system_email`.

- [ ] **Step 3: Write the migration**

```sql
-- M7: outbox kinds nobody uses leave the enum (spec §6, owner 2026-10-10: remove what is unused).
-- sheet_sync: the Google Sheet has its own worker. push: M8 adds it back only if Web Push uses the
-- outbox. system_email: system emails never went through the outbox.
-- Postgres can't drop an enum value, so the type is rebuilt. The one index whose predicate names a
-- kind is dropped and re-created around the swap; functions that declare a job_kind variable are
-- touched afterwards so PL/pgSQL recompiles them against the new type in long-lived sessions.

do $$
begin
  if exists (select 1 from public.outbox_jobs where kind::text in ('sheet_sync', 'push', 'system_email')) then
    raise exception 'outbox_jobs still holds a removed kind';
  end if;
end;
$$;

drop index public.outbox_jobs_due_timers_idx;
alter type public.job_kind rename to job_kind_old;
create type public.job_kind as enum ('invite', 'calendar_confirm', 'update', 'cancel', 'reminder');
alter table public.outbox_jobs alter column kind type public.job_kind using kind::text::public.job_kind;
drop type public.job_kind_old;
create index outbox_jobs_due_timers_idx on public.outbox_jobs (run_after)
  where kind = 'reminder' and invitee_id is null and status = 'pending';

alter function public.dispatch_finish(uuid, public.invitee_email_status, text, text) set search_path = '';
alter function public.dispatch_retry(uuid, text) set search_path = '';
```

Before writing the last two lines, find every function that declares a `public.job_kind` variable:
```bash
grep -n "public.job_kind" supabase/migrations/*.sql
```
Expected: `dispatch_finish` and `dispatch_retry` only, besides the type and table definitions. If another appears, add an `alter function … set search_path = ''` line for it too, and record the extra line as a ruling.

If `drop type public.job_kind_old` fails with "cannot drop type … because other objects depend on it", list them with:
```sql
select pg_catalog.pg_describe_object(classid, objid, objsubid)
from pg_catalog.pg_depend
where refobjid = 'public.job_kind_old'::regtype;
```
Re-create those objects the same way the index is re-created.

- [ ] **Step 4: Point the parser test at a kind that never existed**

In `src/server/queries/dispatch.test.ts`, change `dbJob(1, { kind: "system_email" })` to `dbJob(1, { kind: "fax" })`, and rename the test name's wording if it mentions system email. Also extend the JSDoc of `jobKindSchema` in `src/server/queries/dispatch.ts`:

```ts
/**
 * Every kind the dispatcher sends; one it doesn't know would fail the whole claim. Twin:
 * `public.job_kind` (M7 removed the kinds nobody used, so the two lists are equal).
 */
```

- [ ] **Step 5: Run the tests**

```bash
supabase db reset --local </dev/null && bun run db:types && bun run test:db && bun run test
```
Expected: all pass, including every dispatcher DB test (`run-dispatch.db.test.ts`, `outbox.db.test.ts`), which proves the outbox still works.

Then run `supabase db advisors --local </dev/null`. Expected: only the pre-existing auth WARN.

- [ ] **Step 6: Commit, PR, merge, hosted push**

```bash
git checkout -b feat/<issue>-m7-job-kinds
git add supabase/migrations src/server/db src/server/queries
git commit -m "feat(db): outbox job kinds without the unused ones"
```
PR with `Closes #<issue>`, labels `type:task`, `area:db`, `area:pipeline`. Then `merge-when-green.sh <pr>` (background), confirm `MERGED`, and **run `bash .superpowers/scripts/hosted-push.sh`**. Record the advisors in the ledger.

---
### Task 4: Sheet layout library (pure TypeScript)

**Labels:** `type:task`, `area:pipeline`. No I/O and no `server-only`, so the browser can use `url.ts` too.

**Files:**
- Create: `src/lib/sheets/types.ts`, `year.ts`, `words.ts`, `tabs.ts`, `content.ts`, `requests.ts`, `url.ts`, and tests `year.test.ts`, `tabs.test.ts`, `content.test.ts`, `requests.test.ts`, `url.test.ts`; `src/test/fixtures/sheet-rows.ts`
- Modify: `messages/en.json` (`Sheet` namespace)

**Interfaces:**
- Consumes:
  - `attendanceDetailRows`, `ExportCell`, `TintedCell` (`src/lib/export/rows.ts`);
  - `DETAIL_COLUMNS` (`columns.ts`), `exportWords` / `AppMessages` (`words.ts`);
  - `EXPORT_COLORS`, `EXPORT_HEADER_ROWS`, `EXPORT_FONT_FAMILY`, `EXPORT_FONT_SIZE`, `fittedWidth` (`theme.ts`);
  - `AttendanceDetailRow` (`src/shared/api/responses.ts`), `FillTone` (`src/design/tokens.ts`).
- Produces (Task 8 relies on these exact names):
```ts
// types.ts
export type SheetSourceRow = AttendanceDetailRow & {
  meetingStatus: "scheduled" | "cancelled";
  lists: string[];
};
export type Band = "even" | "odd" | "cancelled";
export type PlannedTab = {
  key: string;            // "2026" or "2026-1" (newest chunk = 1)
  year: number;
  title: string;          // "2026" or "2026 · 3 Jan – 28 Apr"
  rows: SheetSourceRow[]; // newest meeting first, then name
  startsFrom: string | null; // oldest meeting start in the tab
  startsTo: string | null;   // newest meeting start in the tab
};
export type TabContent = {
  band: string;           // the title band text
  subtitle: string;
  header: string[];       // DETAIL_COLUMNS headers (15)
  values: (string | number | null)[][]; // one per row, 15 cells, tints as their text
  helpers: [Band, FillTone | "", FillTone | ""][]; // band, Answer tone, Checked in tone
  widths: number[];       // characters, per DETAIL_COLUMNS column
};
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type SheetsRequest = { [kind: string]: Json };
// year.ts
export function sheetYear(startsAt: string, timezone: string): number;
// words.ts
export type SheetWords = ExportWords & { sheet: SheetTranslator };
export function sheetWords(locale: Locale, catalogue: AppMessages): SheetWords;
// tabs.ts
export function planYearTabs(year: number, rows: SheetSourceRow[], options: { maxRows: number; currentYear: number; words: SheetWords }): PlannedTab[];
export function resolveTitle(desired: string, takenByOthers: ReadonlySet<string>, words: SheetWords): string;
// content.ts
export function tabContent(tab: PlannedTab, context: { workspaceName: string; updatedAt: Date; timezone: string; words: SheetWords }): TabContent;
export function contentFingerprint(tab: PlannedTab, content: TabContent): string; // stable JSON without the subtitle
// requests.ts
export const SHEET_COLUMNS: number; // 15 visible + 3 hidden helpers = 18
export function addSheetRequest(sheetId: number, title: string, index: number): SheetsRequest;
export function deleteSheetRequest(sheetId: number): SheetsRequest;
export function formatRequests(sheetId: number, existing: { conditionalFormats: number; slicerIds: number[] }, words: SheetWords, slicerId: number): SheetsRequest[];
export function redrawRequests(sheetId: number, title: string, content: TabContent, slicerId: number): SheetsRequest[]; // S6: also resets the slicer's range
// url.ts
export function sheetUrl(spreadsheetId: string, gid?: number): string;
export function tabForMeeting(tabs: ReadonlyArray<{ googleSheetId: number; year: number; startsFrom: string | null; startsTo: string | null }>, startsAt: string | null, timezone: string): number | undefined;
```

- [ ] **Step 1: Add the `Sheet` messages**

`messages/en.json`, top-level `"Sheet"`:
```json
"Sheet": {
  "fileName": "{workspace} · TapNShow",
  "band": "{workspace} · Responses {tab}",
  "subtitle": "Updated {at} · Changes made here are replaced by TapNShow",
  "meetingCell": "{title} · {date}",
  "cancelled": "{meeting} · Cancelled",
  "tabRange": "{year} · {from} – {to}",
  "tabTaken": "{title} (TapNShow)"
}
```

- [ ] **Step 2: Write `year.ts` with its failing test**

`year.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sheetYear } from "./year";

describe("sheetYear (twin: private.sheet_year)", () => {
  it("uses the meeting's own zone", () => {
    expect(sheetYear("2026-12-31T23:30:00.000Z", "Africa/Tunis")).toBe(2027);
    expect(sheetYear("2026-12-31T23:30:00.000Z", "America/New_York")).toBe(2026);
  });
});
```
Run: `bun run test src/lib/sheets/year.test.ts`
Expected: FAIL (module missing).

```ts
import { TZDate } from "@date-fns/tz";

/** The year tab a meeting belongs to: its start's year in its own zone. Twin: `private.sheet_year`. */
export function sheetYear(startsAt: string, timezone: string): number {
  return new TZDate(startsAt, timezone).getFullYear();
}
```
Run it again. Expected: PASS.

- [ ] **Step 3: Write `words.ts` and the shared fixture**

```ts
import { createTranslator } from "next-intl";
import type { Locale } from "@/config/i18n";
import { type AppMessages, type ExportWords, exportWords } from "@/lib/export/words";

function sheetTranslator(locale: Locale, catalogue: AppMessages) {
  return createTranslator({ locale, messages: catalogue, namespace: "Sheet" });
}

/** The `Sheet` namespace translator. */
export type SheetTranslator = ReturnType<typeof sheetTranslator>;

/** Export words plus the Google Sheet's own (band, subtitle, meeting cell, tab names). */
export type SheetWords = ExportWords & { sheet: SheetTranslator };

/** Every word a Google Sheet tab needs, for one locale. */
export function sheetWords(locale: Locale, catalogue: AppMessages): SheetWords {
  return { ...exportWords(locale, catalogue), sheet: sheetTranslator(locale, catalogue) };
}
```

`src/test/fixtures/sheet-rows.ts`:
```ts
import type { SheetSourceRow } from "@/lib/sheets/types";

let next = 0;
const uuid = () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`;

/** One sheet row for a meeting; override what the test is about. */
export function sheetRow(
  meeting: { id: string; title?: string; startsAt: string; status?: "scheduled" | "cancelled" },
  overrides: Partial<SheetSourceRow> = {},
): SheetSourceRow {
  return {
    meetingId: meeting.id,
    title: meeting.title ?? "Weekly sync",
    startsAt: meeting.startsAt,
    timezone: "Africa/Tunis",
    responseMode: "attendance",
    meetingStatus: meeting.status ?? "scheduled",
    inviteeId: uuid(),
    contactId: uuid(),
    fullName: "Amira Ben Salah",
    email: "amira@uni.tn",
    emailStatus: "sent",
    answer: null,
    mark: null,
    lists: [],
    ...overrides,
  };
}
```

`AttendanceDetailRow` may carry more fields than listed (check `attendanceDetailRowSchema`). If it does, add them with neutral values so the fixture type-checks; never loosen the type.

- [ ] **Step 4: Write the failing `tabs` tests**

`tabs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { sheetRow } from "@/test/fixtures/sheet-rows";
import { planYearTabs, resolveTitle } from "./tabs";
import { sheetWords } from "./words";

const words = sheetWords("en", messages);
const meeting = (id: string, startsAt: string, people: number) =>
  Array.from({ length: people }, () => sheetRow({ id, startsAt }));

describe("planYearTabs", () => {
  it("keeps a year under the cap in one tab named by the year", () => {
    const rows = [...meeting("m2", "2026-10-15T17:00:00Z", 3), ...meeting("m1", "2026-10-08T17:00:00Z", 2)];
    const tabs = planYearTabs(2026, rows, { maxRows: 10, currentYear: 2026, words });
    expect(tabs.map((tab) => [tab.key, tab.title, tab.rows.length])).toEqual([["2026", "2026", 5]]);
    expect(tabs[0].startsTo).toBe("2026-10-15T17:00:00Z");
    expect(tabs[0].startsFrom).toBe("2026-10-08T17:00:00Z");
  });

  it("splits a big year at meeting boundaries, newest chunk first, named by its days", () => {
    const rows = [
      ...meeting("m3", "2026-04-28T17:00:00Z", 4),
      ...meeting("m2", "2026-02-10T17:00:00Z", 4),
      ...meeting("m1", "2026-01-03T17:00:00Z", 4),
    ];
    const tabs = planYearTabs(2026, rows, { maxRows: 8, currentYear: 2026, words });
    expect(tabs.map((tab) => [tab.key, tab.title, tab.rows.length])).toEqual([
      ["2026-1", "2026 · 10 Feb – 28 Apr", 8],
      ["2026-2", "2026 · 3 Jan – 3 Jan", 4],
    ]);
  });

  it("never splits one meeting, even when it alone is over the cap", () => {
    const tabs = planYearTabs(2026, meeting("m1", "2026-03-01T17:00:00Z", 12), { maxRows: 8, currentYear: 2026, words });
    expect(tabs.map((tab) => tab.rows.length)).toEqual([12]);
  });

  it("keeps an empty current-year tab, and drops an empty past year", () => {
    expect(planYearTabs(2026, [], { maxRows: 8, currentYear: 2026, words }).map((tab) => tab.key)).toEqual(["2026"]);
    expect(planYearTabs(2025, [], { maxRows: 8, currentYear: 2026, words })).toEqual([]);
  });
});

describe("resolveTitle", () => {
  it("leaves a title alone unless someone else's tab already has it", () => {
    expect(resolveTitle("2026", new Set(["Summary"]), words)).toBe("2026");
    expect(resolveTitle("2026", new Set(["2026"]), words)).toBe("2026 (TapNShow)");
  });
});
```

Run: `bun run test src/lib/sheets/tabs.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 5: Write `tabs.ts`**

```ts
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { PlannedTab, SheetSourceRow } from "./types";
import type { SheetWords } from "./words";

type MeetingBlock = { meetingId: string; rows: SheetSourceRow[] };

/** Consecutive rows of one meeting (the query orders by start, then meeting, then name). */
function blocks(rows: SheetSourceRow[]): MeetingBlock[] {
  const out: MeetingBlock[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last && last.meetingId === row.meetingId) {
      last.rows.push(row);
    } else {
      out.push({ meetingId: row.meetingId, rows: [row] });
    }
  }
  return out;
}

const day = (row: SheetSourceRow) => format(new TZDate(row.startsAt, row.timezone), "d MMM");

/**
 * The tabs of one year (spec §7.17): one tab named by the year, or, above `maxRows`, chunks split at
 * meeting boundaries (never inside a meeting), newest first, named by their first and last days.
 * An empty year keeps a header-only tab only when it is the current year.
 */
export function planYearTabs(
  year: number,
  rows: SheetSourceRow[],
  options: { maxRows: number; currentYear: number; words: SheetWords },
): PlannedTab[] {
  if (rows.length === 0) {
    return year === options.currentYear
      ? [{ key: String(year), year, title: String(year), rows: [], startsFrom: null, startsTo: null }]
      : [];
  }
  const chunks: SheetSourceRow[][] = [];
  for (const block of blocks(rows)) {
    const current = chunks.at(-1);
    if (current && current.length + block.rows.length <= options.maxRows) {
      current.push(...block.rows);
    } else {
      chunks.push([...block.rows]);
    }
  }
  const single = chunks.length === 1;
  return chunks.map((chunk, index) => {
    const newest = chunk[0];
    const oldest = chunk[chunk.length - 1];
    return {
      key: single ? String(year) : `${year}-${index + 1}`,
      year,
      title: single
        ? String(year)
        : options.words.sheet("tabRange", { year, from: day(oldest), to: day(newest) }),
      rows: chunk,
      startsFrom: oldest.startsAt,
      startsTo: newest.startsAt,
    };
  });
}

/** Our title, unless a tab TapNShow didn't make already has it ("2026 (TapNShow)"). */
export function resolveTitle(desired: string, takenByOthers: ReadonlySet<string>, words: SheetWords): string {
  return takenByOthers.has(desired) ? words.sheet("tabTaken", { title: desired }) : desired;
}
```

Run: `bun run test src/lib/sheets/tabs.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing `content` tests**

`content.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { sheetRow } from "@/test/fixtures/sheet-rows";
import { contentFingerprint, tabContent } from "./content";
import { planYearTabs } from "./tabs";
import { sheetWords } from "./words";

const words = sheetWords("en", messages);
const answer = (status: "attending" | "late" | "absent", delayMinutes: number | null = null) => ({
  status,
  delayMinutes,
  reason: status === "absent" ? "Exam" : "",
  comment: "",
  afterDeadline: false,
  updatedAt: "2026-10-12T09:00:00.000Z",
  needsReconfirmation: false,
});

function build(rows: Parameters<typeof planYearTabs>[1]) {
  const [tab] = planYearTabs(2026, rows, { maxRows: 100, currentYear: 2026, words });
  return {
    tab,
    content: tabContent(tab, {
      workspaceName: "GDG ISSAT",
      updatedAt: new Date("2026-10-12T21:15:00.000Z"),
      timezone: "Africa/Tunis",
      words,
    }),
  };
}

describe("tabContent", () => {
  it("names the band, the update time and the columns like the Excel Details sheet", () => {
    const { content } = build([sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" })]);
    expect(content.band).toBe("GDG ISSAT · Responses 2026");
    expect(content.subtitle).toBe("Updated Mon 12 Oct, 22:15 · Changes made here are replaced by TapNShow");
    expect(content.header).toHaveLength(15);
    expect(content.header[0]).toBe("Meeting");
    expect(content.header[9]).toBe("Answered at");
  });

  it("puts the date in the meeting cell, bands meetings in turn, greys a cancelled one", () => {
    const { content } = build([
      sheetRow({ id: "m3", startsAt: "2026-10-15T17:00:00Z" }),
      sheetRow({ id: "m2", startsAt: "2026-10-08T13:00:00Z", status: "cancelled", title: "Flutter workshop" }),
      sheetRow({ id: "m1", startsAt: "2026-10-01T17:00:00Z" }),
    ]);
    expect(content.values.map((row) => row[0])).toEqual([
      "Weekly sync · Thu 15 Oct",
      "Flutter workshop · Thu 8 Oct · Cancelled",
      "Weekly sync · Thu 1 Oct",
    ]);
    expect(content.helpers.map((helper) => helper[0])).toEqual(["even", "cancelled", "even"]);
  });

  it("writes tints as text and their tones in the helper columns", () => {
    const { content } = build([
      sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" }, { answer: answer("late", 15) }),
      sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" }, { answer: answer("absent"), mark: { actual: "absent", markedAt: "2026-10-15T18:00:00Z", markedByName: "Daly", lateMinutes: null } }),
      sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" }),
    ]);
    expect(content.values.map((row) => row[5])).toEqual(["Late by 15 min", "Can't come", "No reply"]);
    expect(content.helpers).toEqual([
      ["even", "warning", ""],
      ["even", "danger", "danger"],
      ["even", "neutral", ""],
    ]);
  });

  it("keeps text that looks like a formula as plain text", () => {
    const { content } = build([
      sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" }, { fullName: "=HYPERLINK(\"x\")" }),
    ]);
    expect(content.values[0][2]).toBe("=HYPERLINK(\"x\")");
  });

  it("fingerprints the content without the update time", () => {
    const rows = [sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" })];
    const first = build(rows);
    const later = tabContent(first.tab, { workspaceName: "GDG ISSAT", updatedAt: new Date("2026-10-13T08:00:00Z"), timezone: "Africa/Tunis", words });
    expect(contentFingerprint(first.tab, later)).toBe(contentFingerprint(first.tab, first.content));
  });
});
```

The subtitle's date wording must equal what `formatDeadline` produces for the export band today. If `formatDeadline` prints another shape, change the expected string to match it, so both exports read the same; don't add a second formatter.

Run: `bun run test src/lib/sheets/content.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 7: Write `content.ts`**

```ts
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { FillTone } from "@/design/tokens";
import { DETAIL_COLUMNS } from "@/lib/export/columns";
import { attendanceDetailRows, type ExportCell } from "@/lib/export/rows";
import { fittedWidth } from "@/lib/export/theme";
import { formatDeadline } from "@/lib/meetings/format";
import type { Band, PlannedTab, SheetSourceRow, TabContent } from "./types";
import type { SheetWords } from "./words";

const ANSWER = DETAIL_COLUMNS.findIndex((column) => column.key === "answer");
const CHECKED_IN = DETAIL_COLUMNS.findIndex((column) => column.key === "checkedIn");

const plain = (cell: ExportCell): string | number | null =>
  cell !== null && typeof cell === "object" ? cell.text : cell === "" ? null : cell;
const tone = (cell: ExportCell): FillTone | "" =>
  cell !== null && typeof cell === "object" ? cell.tone : "";

/** One band per meeting, alternating; a cancelled meeting is always grey. */
function bands(rows: SheetSourceRow[]): Band[] {
  let index = -1;
  let last = "";
  return rows.map((row) => {
    if (row.meetingId !== last) {
      index += 1;
      last = row.meetingId;
    }
    if (row.meetingStatus === "cancelled") {
      return "cancelled";
    }
    return index % 2 === 0 ? "even" : "odd";
  });
}

/**
 * What one tab shows (spec §7.17): the band, the subtitle, the Details columns, one row per invited
 * person (the Excel row builder, so both stay equal), and the hidden helper values that colour it.
 */
export function tabContent(
  tab: PlannedTab,
  context: { workspaceName: string; updatedAt: Date; timezone: string; words: SheetWords },
): TabContent {
  const { words } = context;
  const listNames = new Map(tab.rows.map((row) => [row.contactId, row.lists]));
  const cells = attendanceDetailRows(tab.rows, listNames, words.labels, words.text, {
    meetingCell: (row) => {
      const named = words.sheet("meetingCell", {
        title: row.title,
        date: format(new TZDate(row.startsAt, row.timezone), "EEE d MMM"),
      });
      const source = tab.rows.find((candidate) => candidate.meetingId === row.meetingId);
      return source?.meetingStatus === "cancelled" ? words.sheet("cancelled", { meeting: named }) : named;
    },
  });
  const band = bands(tab.rows);
  const values = cells.map((row) => row.map(plain));
  const header = DETAIL_COLUMNS.map((column) => words.column(column.key));
  return {
    band: words.sheet("band", { workspace: context.workspaceName, tab: tab.title }),
    subtitle: words.sheet("subtitle", { at: formatDeadline(context.updatedAt.toISOString(), context.timezone) }),
    header,
    values,
    helpers: cells.map((row, index) => [band[index], tone(row[ANSWER]), tone(row[CHECKED_IN])]),
    widths: DETAIL_COLUMNS.map((column, index) =>
      fittedWidth(header[index], values.map((row) => row[index]), column.width),
    ),
  };
}

/** What a redraw compares: everything shown except the update time. */
export function contentFingerprint(tab: PlannedTab, content: TabContent): string {
  return JSON.stringify([tab.title, content.band, content.header, content.values, content.helpers]);
}
```

The `meetingCell` callback receives an `AttendanceDetailRow`. `SheetSourceRow` extends it, so `attendanceDetailRows(tab.rows, …)` passes the same objects. Instead of the `find`, narrow with a `Map<meetingId, status>` built once: create `const statusOf = new Map(tab.rows.map((r) => [r.meetingId, r.meetingStatus]))` before calling `attendanceDetailRows`, and read `statusOf.get(row.meetingId)`. That keeps the cost linear.

Run: `bun run test src/lib/sheets/content.test.ts`
Expected: PASS.

- [ ] **Step 8: Write the failing `requests` tests**

`requests.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { EXPORT_COLORS } from "@/lib/export/theme";
import { sheetRow } from "@/test/fixtures/sheet-rows";
import { tabContent } from "./content";
import { formatRequests, redrawRequests, SHEET_COLUMNS } from "./requests";
import { planYearTabs } from "./tabs";
import { sheetWords } from "./words";

const words = sheetWords("en", messages);
const [tab] = planYearTabs(2026, [sheetRow({ id: "m1", startsAt: "2026-10-15T17:00:00Z" })], { maxRows: 10, currentYear: 2026, words });
const content = tabContent(tab, { workspaceName: "GDG", updatedAt: new Date("2026-10-12T21:15:00Z"), timezone: "Africa/Tunis", words });

describe("redrawRequests", () => {
  const requests = redrawRequests(42, "2026", content, 77);

  it("sets the exact row count (header rows plus at least one row), freezes the header", () => {
    expect(requests[0]).toEqual({
      updateSheetProperties: {
        properties: {
          sheetId: 42,
          title: "2026",
          gridProperties: { rowCount: 5, columnCount: SHEET_COLUMNS, frozenRowCount: 4 },
        },
        fields: "title,gridProperties(rowCount,columnCount,frozenRowCount)",
      },
    });
  });

  it("writes values only, as text or numbers, with the helpers last", () => {
    const write = requests.find((request) => "updateCells" in request);
    expect(JSON.stringify(write)).toContain('"fields":"userEnteredValue"');
    expect(JSON.stringify(write)).toContain('{"userEnteredValue":{"stringValue":"Weekly sync · Thu 15 Oct"}}');
    expect(JSON.stringify(write)).toContain('{"userEnteredValue":{"stringValue":"even"}}');
    expect(JSON.stringify(write)).not.toContain("formulaValue");
  });

  it("moves the Meeting filter box's range to the exact last row (S6: a slicer's range does not grow)", () => {
    expect(requests).toContainEqual({
      updateSlicerSpec: {
        slicerId: 77,
        spec: { dataRange: { sheetId: 42, startRowIndex: 3, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 15 } },
        fields: "dataRange",
      },
    });
  });
});

describe("formatRequests", () => {
  it("replaces old rules and slicers, then adds tone rules before band rules and one slicer", () => {
    const requests = formatRequests(42, { conditionalFormats: 2, slicerIds: [7] }, words, 77);
    const kinds = requests.map((request) => Object.keys(request)[0]);
    expect(kinds.slice(0, 3)).toEqual(["deleteConditionalFormatRule", "deleteConditionalFormatRule", "deleteEmbeddedObject"]);
    const rules = requests.filter((request) => "addConditionalFormatRule" in request).map((request) => JSON.stringify(request));
    expect(rules[0]).toContain('=$Q5=\\"success\\"');
    expect(rules.at(-1)).toContain('=$P5=\\"cancelled\\"');
    expect(kinds.filter((kind) => kind === "addSlicer")).toHaveLength(1);
    expect(JSON.stringify(requests)).toContain('"slicerId":77');
    expect(JSON.stringify(requests)).toContain(String(Math.round((parseInt(EXPORT_COLORS.primary.slice(1, 3), 16) / 255) * 1000) / 1000));
  });
});
```

Run: `bun run test src/lib/sheets/requests.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 9: Write `requests.ts`**

```ts
import type { FillTone } from "@/design/tokens";
import { DETAIL_COLUMNS } from "@/lib/export/columns";
import {
  EXPORT_COLORS,
  EXPORT_FONT_FAMILY,
  EXPORT_FONT_SIZE,
  EXPORT_HEADER_ROWS,
} from "@/lib/export/theme";
import type { Json, SheetsRequest, TabContent } from "./types";
import type { SheetWords } from "./words";

const VISIBLE = DETAIL_COLUMNS.length;
/** Hidden helper columns after the table: band, Answer tone, Checked in tone (spec §8). */
const BAND_COLUMN = VISIBLE;
const ANSWER_TONE_COLUMN = VISIBLE + 1;
const CHECK_TONE_COLUMN = VISIBLE + 2;
/** Every column a TapNShow tab has. */
export const SHEET_COLUMNS = VISIBLE + 3;
const ANSWER = DETAIL_COLUMNS.findIndex((column) => column.key === "answer");
const CHECKED_IN = DETAIL_COLUMNS.findIndex((column) => column.key === "checkedIn");
const TINTS: ReadonlyArray<FillTone> = ["success", "warning", "danger", "neutral"];
/** Pixels per character, matching how Excel sizes the same widths. */
const PX_PER_CHAR = 7;

/** "A", …, "Z", "AA" for a zero-based column index. */
function letter(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** `#C4B5FD` → Sheets' 0–1 colour, rounded to 3 decimals. */
function rgb(hex: string): { [key: string]: Json } {
  const part = (start: number) => Math.round((parseInt(hex.slice(start, start + 2), 16) / 255) * 1000) / 1000;
  return { red: part(1), green: part(3), blue: part(5) };
}

const range = (sheetId: number, rows: [number, number?], columns: [number, number]) => ({
  sheetId,
  startRowIndex: rows[0],
  ...(rows[1] === undefined ? {} : { endRowIndex: rows[1] }),
  startColumnIndex: columns[0],
  endColumnIndex: columns[1],
});

const border = { style: "SOLID", color: rgb(EXPORT_COLORS.ink) };
const font = (extra: { [key: string]: Json } = {}) => ({
  fontFamily: EXPORT_FONT_FAMILY,
  fontSize: EXPORT_FONT_SIZE,
  foregroundColor: rgb(EXPORT_COLORS.ink),
  ...extra,
});

function rule(sheetId: number, columns: [number, number], formula: string, color: string): SheetsRequest {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [range(sheetId, [EXPORT_HEADER_ROWS], columns)],
        booleanRule: {
          condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: formula }] },
          format: { backgroundColor: rgb(color) },
        },
      },
    },
  };
}

/** A new TapNShow tab at `index` (our own id, so later requests in the batch can name it). */
export function addSheetRequest(sheetId: number, title: string, index: number): SheetsRequest {
  return { addSheet: { properties: { sheetId, title, index } } };
}

/** Removes a TapNShow tab that has nothing left to show. */
export function deleteSheetRequest(sheetId: number): SheetsRequest {
  return { deleteSheet: { sheetId } };
}

/**
 * The formatting a tab keeps between redraws (applied when it is created, when its format version
 * is old, or when someone removed it): title band merges and styles, the header, hidden helper
 * columns, colour rules on open-ended ranges, and the Meeting filter box. Old rules and slicers are
 * removed first, so applying it twice leaves the same tab.
 */
export function formatRequests(
  sheetId: number,
  existing: { conditionalFormats: number; slicerIds: number[] },
  words: SheetWords,
  slicerId: number,
): SheetsRequest[] {
  const whole: [number, number] = [0, VISIBLE];
  const helper = (column: number) => `$${letter(column)}${EXPORT_HEADER_ROWS + 1}`;
  // Rules added at index 0 end up in reverse order, so the band rules go in first: the tone rules,
  // added last, are checked first (the first matching rule wins).
  const bandRules = [
    rule(sheetId, whole, `=${helper(BAND_COLUMN)}="cancelled"`, EXPORT_COLORS.neutral),
    rule(sheetId, whole, `=${helper(BAND_COLUMN)}="odd"`, EXPORT_COLORS.background),
  ];
  const toneRules = TINTS.flatMap((tint) => [
    rule(sheetId, [CHECKED_IN, CHECKED_IN + 1], `=${helper(CHECK_TONE_COLUMN)}="${tint}"`, EXPORT_COLORS[tint]),
    rule(sheetId, [ANSWER, ANSWER + 1], `=${helper(ANSWER_TONE_COLUMN)}="${tint}"`, EXPORT_COLORS[tint]),
  ]);
  return [
    ...Array.from({ length: existing.conditionalFormats }, () => ({
      deleteConditionalFormatRule: { sheetId, index: 0 },
    })),
    ...existing.slicerIds.map((objectId) => ({ deleteEmbeddedObject: { objectId } })),
    { unmergeCells: { range: range(sheetId, [0, 2], whole) } },
    { mergeCells: { range: range(sheetId, [0, 1], whole), mergeType: "MERGE_ALL" } },
    { mergeCells: { range: range(sheetId, [1, 2], whole), mergeType: "MERGE_ALL" } },
    {
      repeatCell: {
        range: range(sheetId, [0, 1], whole),
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: font({ bold: true, fontSize: 16 }) } },
        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
      },
    },
    {
      repeatCell: {
        range: range(sheetId, [1, 2], whole),
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", textFormat: font({ foregroundColor: rgb(EXPORT_COLORS.muted) }) } },
        fields: "userEnteredFormat(horizontalAlignment,textFormat)",
      },
    },
    {
      repeatCell: {
        range: range(sheetId, [EXPORT_HEADER_ROWS - 1, EXPORT_HEADER_ROWS], whole),
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(EXPORT_COLORS.primary),
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
            textFormat: font({ bold: true }),
            borders: { top: { ...border, style: "SOLID_MEDIUM" }, bottom: { ...border, style: "SOLID_MEDIUM" }, left: border, right: border },
          },
        },
        fields: "userEnteredFormat(backgroundColor,verticalAlignment,wrapStrategy,textFormat,borders)",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: VISIBLE, endIndex: SHEET_COLUMNS },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
    ...bandRules,
    ...toneRules,
    {
      addSlicer: {
        slicer: {
          slicerId,
          spec: {
            dataRange: range(sheetId, [EXPORT_HEADER_ROWS - 1], whole),
            columnIndex: 0,
            title: words.column("meeting"),
            applyToPivotTables: false,
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId, rowIndex: EXPORT_HEADER_ROWS - 2, columnIndex: 0 },
              widthPixels: 240,
              heightPixels: 30,
            },
          },
        },
      },
    },
  ];
}

const value = (cell: string | number | null): { [key: string]: Json } =>
  cell === null || cell === ""
    ? {}
    : { userEnteredValue: typeof cell === "number" ? { numberValue: cell } : { stringValue: cell } };

/**
 * One redraw (spec §8): exact row count (leftover rows go), our title back, borders and fonts on the
 * data rows, fitted widths, and every value from A1 (values only; colours come from the rules).
 */
export function redrawRequests(sheetId: number, title: string, content: TabContent, slicerId: number): SheetsRequest[] {
  const rows = Math.max(content.values.length, 1);
  const lastRow = EXPORT_HEADER_ROWS + rows;
  const blank = (count: number) => Array.from({ length: count }, () => ({}));
  return [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          title,
          gridProperties: { rowCount: lastRow, columnCount: SHEET_COLUMNS, frozenRowCount: EXPORT_HEADER_ROWS },
        },
        fields: "title,gridProperties(rowCount,columnCount,frozenRowCount)",
      },
    },
    {
      // S6: a slicer keeps the row count it was created with, so each redraw resets its range.
      updateSlicerSpec: {
        slicerId,
        spec: { dataRange: range(sheetId, [EXPORT_HEADER_ROWS - 1, lastRow], [0, VISIBLE]) },
        fields: "dataRange",
      },
    },
    {
      repeatCell: {
        range: range(sheetId, [EXPORT_HEADER_ROWS, lastRow], [0, VISIBLE]),
        cell: {
          userEnteredFormat: {
            verticalAlignment: "MIDDLE",
            textFormat: font(),
            borders: { top: border, bottom: border, left: border, right: border },
          },
        },
        fields: "userEnteredFormat(verticalAlignment,textFormat,borders)",
      },
    },
    ...content.widths.map((width, index) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
        properties: { pixelSize: width * PX_PER_CHAR },
        fields: "pixelSize",
      },
    })),
    {
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        rows: [
          { values: [value(content.band), ...blank(SHEET_COLUMNS - 1)] },
          { values: [value(content.subtitle), ...blank(SHEET_COLUMNS - 1)] },
          { values: blank(SHEET_COLUMNS) },
          { values: [...content.header.map(value), ...blank(3)] },
          ...(content.values.length === 0
            ? [{ values: blank(SHEET_COLUMNS) }]
            : content.values.map((row, index) => ({
                values: [...row.map(value), ...content.helpers[index].map(value)],
              }))),
        ],
        fields: "userEnteredValue",
      },
    },
  ];
}
```

Run: `bun run test src/lib/sheets/requests.test.ts`
Expected: PASS.

Notes:
- If S6 (Task 1) showed that `addConditionalFormatRule` index semantics differ (the first matching rule wins, and rules are evaluated by index ascending), the tone rules must end with the lowest indexes. The insertion order above achieves that by adding the band rules first at index 0, then the tone rules at index 0.
- If S6 says "first rule wins" with the opposite order, swap the two spreads and record it as a ruling.

- [ ] **Step 10: Write `url.ts` with tests**

`url.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sheetUrl, tabForMeeting } from "./url";

const tabs = [
  { googleSheetId: 11, year: 2026, startsFrom: "2026-05-01T00:00:00Z", startsTo: "2026-10-15T17:00:00Z" },
  { googleSheetId: 12, year: 2026, startsFrom: "2026-01-03T00:00:00Z", startsTo: "2026-04-28T17:00:00Z" },
  { googleSheetId: 13, year: 2025, startsFrom: "2025-02-01T00:00:00Z", startsTo: "2025-12-01T17:00:00Z" },
];

describe("sheet links", () => {
  it("opens the spreadsheet, or one tab of it", () => {
    expect(sheetUrl("abc123")).toBe("https://docs.google.com/spreadsheets/d/abc123/edit");
    expect(sheetUrl("abc123", 12)).toBe("https://docs.google.com/spreadsheets/d/abc123/edit#gid=12");
  });

  it("finds the tab holding a meeting, else the newest tab", () => {
    expect(tabForMeeting(tabs, "2026-02-10T17:00:00Z", "Africa/Tunis")).toBe(12);
    expect(tabForMeeting(tabs, "2025-06-01T17:00:00Z", "Africa/Tunis")).toBe(13);
    expect(tabForMeeting(tabs, null, "Africa/Tunis")).toBe(11);
    expect(tabForMeeting([], null, "Africa/Tunis")).toBeUndefined();
  });
});
```

```ts
import { sheetYear } from "./year";

/** The Google Sheets address of a spreadsheet, opened on one tab when `gid` is given. */
export function sheetUrl(spreadsheetId: string, gid?: number): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
  return gid === undefined ? base : `${base}#gid=${gid}`;
}

/**
 * The tab a meeting's rows are on (Export menus): its year's tab whose range holds the start, else
 * that year's first tab, else the newest tab. `tabs` come newest first.
 */
export function tabForMeeting(
  tabs: ReadonlyArray<{ googleSheetId: number; year: number; startsFrom: string | null; startsTo: string | null }>,
  startsAt: string | null,
  timezone: string,
): number | undefined {
  if (startsAt) {
    const year = sheetYear(startsAt, timezone);
    const ofYear = tabs.filter((tab) => tab.year === year);
    const holding = ofYear.find((tab) => tab.startsFrom !== null && tab.startsTo !== null && tab.startsFrom <= startsAt && startsAt <= tab.startsTo);
    const found = holding ?? ofYear[0];
    if (found) {
      return found.googleSheetId;
    }
  }
  return tabs[0]?.googleSheetId;
}
```

ISO strings in UTC compare correctly as text only when they have the same shape. Compare with `new Date(a).getTime()` instead if the API returns mixed offsets, and make the test feed one with `+01:00`.

Run: `bun run test src/lib/sheets`
Expected: PASS.

- [ ] **Step 11: Full check, commit, PR**

Run: `bunx prettier --write src/lib/sheets src/test/fixtures/sheet-rows.ts messages/en.json && bun run format:check && bun run lint && bun run typecheck && bun run test`
Expected: all pass.

```bash
git checkout -b feat/<issue>-m7-sheet-layout
git add src/lib/sheets src/test/fixtures/sheet-rows.ts messages/en.json
git commit -m "feat: Google Sheet layout (tabs, content, requests)"
```
PR with `Closes #<issue>`, labels `type:task`, `area:pipeline`. Then `merge-when-green.sh`.

---

### Task 5: Google Sheets and Drive client, config, env

**Labels:** `type:task`, `area:api`, `area:config`.

**Files:**
- Create: `src/config/sheets.ts`, `src/server/google/sheets-client.ts`, `src/server/google/sheets-client.test.ts`
- Modify: `src/config/env.ts` (+ `src/config/env.test.ts`)

**Interfaces:**
- Produces:
```ts
// config/sheets.ts — values from S6 (docs/spikes/S6.md)
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const SHEETS_CONNECT_SCOPES: readonly ["openid", "email", typeof DRIVE_FILE_SCOPE];
export const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
export const SHEET_TAB_ROWS_MAX = 2_000;      // S6: about 1.6 MB and 5 s per tab
export const SHEET_CELLS_MAX = 19_000_000;
export const SHEET_REQUEST_TIMEOUT_MS = 15_000; // S6: a full tab takes about a third of it
export const SHEET_BUDGET_MS = 50_000;
export const SHEET_MIN_LEFT_MS: number;        // SHEET_REQUEST_TIMEOUT_MS + 5_000
export const SHEET_CLAIM_BATCH = 5;
export const SHEET_LEASE_SECONDS = 120;
export const SHEET_FORMAT_VERSION = 1;
export const SHEET_STATUS_POLL_MS = 3_000;
// sheets-client.ts
export type GoogleFailure =
  | { kind: "retry"; status: number }
  | { kind: "unauthorized" }
  | { kind: "access_lost" }
  | { kind: "not_found" }
  | { kind: "bug"; status: number; reason: string };
export type GoogleResult<T> = { kind: "ok"; value: T } | GoogleFailure;
export type SheetTabMeta = { sheetId: number; title: string; index: number; conditionalFormats: number; slicerIds: number[] };
export function classifyGoogleResponse(status: number, body: string): GoogleFailure;
export type GoogleSheetsClient = {
  findFile(token: string, createKey: string): Promise<GoogleResult<string | null>>;
  createFile(token: string, input: { name: string; workspaceId: string; createKey: string }): Promise<GoogleResult<string>>;
  fileTrashed(token: string, fileId: string): Promise<GoogleResult<boolean>>;
  readTabs(token: string, spreadsheetId: string): Promise<GoogleResult<SheetTabMeta[]>>;
  batchUpdate(token: string, spreadsheetId: string, requests: SheetsRequest[]): Promise<GoogleResult<null>>;
};
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export function createGoogleSheetsClient(input: { sheetsBaseUrl: string; driveBaseUrl: string; timeoutMs: number; fetchImpl?: FetchLike }): GoogleSheetsClient;
```

- [ ] **Step 1: Write the failing classifier and client tests**

`sheets-client.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { classifyGoogleResponse, createGoogleSheetsClient, type FetchLike } from "./sheets-client";

const error = (code: number, reason: string, status = "") =>
  JSON.stringify({ error: { code, message: "x", status, errors: [{ reason }], details: [{ reason }] } });

describe("classifyGoogleResponse (spec §8 errors)", () => {
  it.each([
    [401, error(401, "authError"), { kind: "unauthorized" }],
    [403, error(403, "rateLimitExceeded"), { kind: "retry", status: 403 }],
    [403, error(403, "userRateLimitExceeded"), { kind: "retry", status: 403 }],
    [403, error(403, "accessNotConfigured"), { kind: "bug", status: 403, reason: "accessNotConfigured" }],
    [403, error(403, "SERVICE_DISABLED", "PERMISSION_DENIED"), { kind: "bug", status: 403, reason: "SERVICE_DISABLED" }],
    [403, error(403, "insufficientFilePermissions"), { kind: "access_lost" }],
    [404, error(404, "notFound"), { kind: "not_found" }],
    [429, error(429, "rateLimitExceeded"), { kind: "retry", status: 429 }],
    [503, "", { kind: "retry", status: 503 }],
    [400, error(400, "badRequest"), { kind: "bug", status: 400, reason: "badRequest" }],
  ])("HTTP %i → %o", (status, body, expected) => {
    expect(classifyGoogleResponse(status, body)).toEqual(expected);
  });
});

describe("createGoogleSheetsClient", () => {
  const reply = (status: number, body: object) =>
    vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status }));

  it("creates the file through Drive with the TapNShow tag", async () => {
    const fetchImpl = reply(200, { id: "file-1" });
    const client = createGoogleSheetsClient({ sheetsBaseUrl: "https://s", driveBaseUrl: "https://d", timeoutMs: 1000, fetchImpl });
    const result = await client.createFile("tok", { name: "GDG · TapNShow", workspaceId: "w1", createKey: "k1" });
    expect(result).toEqual({ kind: "ok", value: "file-1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://d/drive/v3/files?fields=id");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "GDG · TapNShow",
      mimeType: "application/vnd.google-apps.spreadsheet",
      appProperties: { tapnshow_workspace: "w1", tapnshow_create_key: "k1" },
    });
  });

  it("finds a file it made before by its tag, or none", async () => {
    const client = createGoogleSheetsClient({ sheetsBaseUrl: "https://s", driveBaseUrl: "https://d", timeoutMs: 1000, fetchImpl: reply(200, { files: [] }) });
    expect(await client.findFile("tok", "k1")).toEqual({ kind: "ok", value: null });
  });

  it("reads tab ids, titles, rule counts and slicers", async () => {
    const fetchImpl = reply(200, {
      sheets: [{ properties: { sheetId: 0, title: "2026", index: 0 }, conditionalFormats: [{}, {}], slicers: [{ slicerId: 9 }] }],
    });
    const client = createGoogleSheetsClient({ sheetsBaseUrl: "https://s", driveBaseUrl: "https://d", timeoutMs: 1000, fetchImpl });
    expect(await client.readTabs("tok", "file-1")).toEqual({
      kind: "ok",
      value: [{ sheetId: 0, title: "2026", index: 0, conditionalFormats: 2, slicerIds: [9] }],
    });
  });

  it("turns a network failure or a timeout into a retry", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createGoogleSheetsClient({ sheetsBaseUrl: "https://s", driveBaseUrl: "https://d", timeoutMs: 1000, fetchImpl });
    expect(await client.fileTrashed("tok", "file-1")).toEqual({ kind: "retry", status: 0 });
  });
});
```

Run: `bun run test src/server/google/sheets-client.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 2: Write `src/config/sheets.ts`**

Write it with the S6 values, each JSDoc citing its source:
- `SHEET_TAB_ROWS_MAX`: "measured in S6: about N MB and N ms per tab".
- `SHEET_CELLS_MAX`: "Google Drive Help: 20 million cells; we stop at 19 million".
- `SHEET_LEASE_SECONDS`: "twice the internal route's `maxDuration`, twin: `sheet_claim`'s caller".
- `SHEET_REQUEST_TIMEOUT_MS`: "Sheets API limits: requests over 180 s time out; ours give up much earlier so the worker stays inside its budget".

- [ ] **Step 3: Write `sheets-client.ts`**

```ts
import "server-only";
import { z } from "zod";
import { SPREADSHEET_MIME_TYPE } from "@/config/sheets";
import type { SheetsRequest } from "@/lib/sheets/types";

/** Why a Google call failed, for the worker (spec §8 errors). */
export type GoogleFailure =
  | { kind: "retry"; status: number }
  | { kind: "unauthorized" }
  | { kind: "access_lost" }
  | { kind: "not_found" }
  | { kind: "bug"; status: number; reason: string };

/** A Google call's value, or why it failed. */
export type GoogleResult<T> = { kind: "ok"; value: T } | GoogleFailure;

/** One tab as Google describes it (what a redraw must check). */
export type SheetTabMeta = {
  sheetId: number;
  title: string;
  index: number;
  conditionalFormats: number;
  slicerIds: number[];
};

const errorSchema = z.object({
  error: z.object({
    status: z.string().default(""),
    errors: z.array(z.object({ reason: z.string().optional() })).default([]),
    details: z.array(z.object({ reason: z.string().optional() })).default([]),
  }),
});
const RATE_LIMIT = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const DISABLED = new Set(["accessNotConfigured", "SERVICE_DISABLED"]);

/**
 * Maps a non-2xx Sheets or Drive response (Google's "Resolve errors" guides; S6). Drive reports
 * rate limits as 403, and a disabled API is our setup, not the Owner's, so neither pauses a sheet.
 */
export function classifyGoogleResponse(status: number, body: string): GoogleFailure {
  let reasons: string[] = [];
  try {
    const parsed = errorSchema.safeParse(JSON.parse(body));
    if (parsed.success) {
      reasons = [...parsed.data.error.errors, ...parsed.data.error.details]
        .map((entry) => entry.reason ?? "")
        .filter(Boolean);
    }
  } catch {
    reasons = [];
  }
  if (status === 401) {
    return { kind: "unauthorized" };
  }
  if (status === 403) {
    if (reasons.some((reason) => RATE_LIMIT.has(reason))) {
      return { kind: "retry", status };
    }
    const disabled = reasons.find((reason) => DISABLED.has(reason));
    return disabled ? { kind: "bug", status, reason: disabled } : { kind: "access_lost" };
  }
  if (status === 404) {
    return { kind: "not_found" };
  }
  if (status === 400) {
    return { kind: "bug", status, reason: reasons[0] ?? "bad_request" };
  }
  return { kind: "retry", status };
}

const idSchema = z.object({ id: z.string().min(1) });
const filesSchema = z.object({ files: z.array(idSchema) });
const trashedSchema = z.object({ trashed: z.boolean().default(false) });
const tabsSchema = z.object({
  sheets: z
    .array(
      z.object({
        properties: z.object({ sheetId: z.number().int(), title: z.string(), index: z.number().int() }),
        conditionalFormats: z.array(z.object({})).default([]),
        slicers: z.array(z.object({ slicerId: z.number().int() })).default([]),
      }),
    )
    .default([]),
});

/** The Sheets and Drive calls the worker makes (plain `fetch`, like Gmail; no `googleapis`). */
export type GoogleSheetsClient = {
  findFile(token: string, createKey: string): Promise<GoogleResult<string | null>>;
  createFile(token: string, input: { name: string; workspaceId: string; createKey: string }): Promise<GoogleResult<string>>;
  fileTrashed(token: string, fileId: string): Promise<GoogleResult<boolean>>;
  readTabs(token: string, spreadsheetId: string): Promise<GoogleResult<SheetTabMeta[]>>;
  batchUpdate(token: string, spreadsheetId: string, requests: SheetsRequest[]): Promise<GoogleResult<null>>;
};

/** The part of `fetch` the client uses (tests pass a fake). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A client for one run; never throws (a network failure or a timeout is a retry). */
export function createGoogleSheetsClient(input: {
  sheetsBaseUrl: string;
  driveBaseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): GoogleSheetsClient {
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));
  async function call<T>(
    token: string,
    url: string,
    init: { method: "GET" | "POST"; body?: object },
    schema: z.ZodType<T>,
  ): Promise<GoogleResult<T>> {
    try {
      const response = await fetchImpl(url, {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) {
        return classifyGoogleResponse(response.status, text);
      }
      const parsed = schema.safeParse(text ? JSON.parse(text) : {});
      return parsed.success
        ? { kind: "ok", value: parsed.data }
        : { kind: "bug", status: response.status, reason: "unexpected_response" };
    } catch {
      return { kind: "retry", status: 0 };
    }
  }
  const map = <A, B>(result: GoogleResult<A>, f: (value: A) => B): GoogleResult<B> =>
    result.kind === "ok" ? { kind: "ok", value: f(result.value) } : result;
  return {
    findFile: async (token, createKey) => {
      const q = `appProperties has { key='tapnshow_create_key' and value='${createKey}' } and trashed = false`;
      const url = `${input.driveBaseUrl}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`;
      return map(await call(token, url, { method: "GET" }, filesSchema), (body) => body.files[0]?.id ?? null);
    },
    createFile: async (token, { name, workspaceId, createKey }) =>
      map(
        await call(
          token,
          `${input.driveBaseUrl}/drive/v3/files?fields=id`,
          {
            method: "POST",
            body: {
              name,
              mimeType: SPREADSHEET_MIME_TYPE,
              appProperties: { tapnshow_workspace: workspaceId, tapnshow_create_key: createKey },
            },
          },
          idSchema,
        ),
        (body) => body.id,
      ),
    fileTrashed: async (token, fileId) =>
      map(
        await call(token, `${input.driveBaseUrl}/drive/v3/files/${encodeURIComponent(fileId)}?fields=trashed`, { method: "GET" }, trashedSchema),
        (body) => body.trashed,
      ),
    readTabs: async (token, spreadsheetId) =>
      map(
        await call(
          token,
          `${input.sheetsBaseUrl}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("sheets(properties(sheetId,title,index),conditionalFormats(ranges(sheetId)),slicers(slicerId))")}`,
          { method: "GET" },
          tabsSchema,
        ),
        (body) =>
          body.sheets.map((sheet) => ({
            ...sheet.properties,
            conditionalFormats: sheet.conditionalFormats.length,
            slicerIds: sheet.slicers.map((slicer) => slicer.slicerId),
          })),
      ),
    batchUpdate: async (token, spreadsheetId, requests) =>
      map(
        await call(
          token,
          `${input.sheetsBaseUrl}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
          { method: "POST", body: { requests } },
          z.object({}),
        ),
        () => null,
      ),
  };
}
```

`createKey` is a uuid the database generates, so it never holds a quote. Its JSDoc on `findFile` says so, and the worker passes only `sheet_syncs.create_key`.

Run: `bun run test src/server/google/sheets-client.test.ts`
Expected: PASS.

- [ ] **Step 4: Env with a failing test first**

Add to `src/config/env.test.ts`:
```ts
it("points the Google Sheet at Google unless overridden (e2e fakes)", () => {
  const env = parseServerEnv(validEnvFixture);
  expect(env.GOOGLE_SHEETS_API_BASE_URL).toBe("https://sheets.googleapis.com");
  expect(env.GOOGLE_DRIVE_API_BASE_URL).toBe("https://www.googleapis.com");
});
```
Use the file's existing minimal valid env object, whatever it's called there.

Run it. Expected: FAIL, because the properties are undefined. Then add to `serverEnvSchema`:
```ts
GOOGLE_SHEETS_API_BASE_URL: z.url().default("https://sheets.googleapis.com"),
GOOGLE_DRIVE_API_BASE_URL: z.url().default("https://www.googleapis.com"),
```
Run it again. Expected: PASS.

- [ ] **Step 5: Full check, commit, PR**

Run: `bunx prettier --write src/config src/server/google && bun run format:check && bun run lint && bun run typecheck && bun run test`
Expected: all pass.

```bash
git checkout -b feat/<issue>-m7-google-sheets-client
git add src/config src/server/google
git commit -m "feat: Google Sheets and Drive client"
```
PR with `Closes #<issue>`, labels `type:task`, `area:api`, `area:config`. Then `merge-when-green.sh`.

---
### Task 6: DB: sheet state, the release rule, start and resume

**Labels:** `type:task`, `area:db`, `area:api`.

**Files:**
- Create: `supabase/migrations/<ts>_m7_sheet_state.sql`, `src/server/db/sheet-state.db.test.ts`, `src/server/queries/sheets.ts`, `src/server/google/release.ts`, `src/server/google/release.test.ts`, `src/test/db/sheets.ts`
- Modify:
  - `src/server/queries/sender.ts`: `disconnectGoogleConnection` returns `{ released, sheetsKept }`; `workspace_sender`'s `my_connections` gains `sheets`;
  - `src/shared/api/sender.ts`: `myConnections[].sheets: string[]`;
  - `src/server/queries/members.ts`: `deleteWorkspace` returns the released connections;
  - `src/app/api/integrations/google/connections/[id]/route.ts` (+ test) and `src/app/api/workspaces/[slug]/route.ts` (DELETE, + test);
  - `src/shared/api/errors.ts`, `messages/en.json` (`sheet_wrong_account`);
  - `src/server/db/function-security.db.test.ts`;
  - `src/test/db/sender.ts` (`seedConnection` takes `scopes`);
  - `src/server/db/database.types.ts`.

**Interfaces:**
- Consumes: `sheetYear`'s rule (SQL twin written here), `revokeGoogleToken` (`google-oauth.ts`), `openSecret` / `connectionAssociatedData` / `parseEncryptionKey` (`secret-box.ts`).
- Produces:
```ts
// src/server/google/release.ts
export type ReleasedConnection = { tokenEncrypted: string; googleSub: string; userId: string };
export const releasedSchema: z.ZodType<ReleasedConnection | null>; // parses private.release_connection's jsonb
export async function revokeReleased(released: ReadonlyArray<ReleasedConnection | null>): Promise<void>; // best effort, never throws, logs counts only
// src/server/queries/sheets.ts (owner/member + callback parts; Task 8 adds the worker store)
export type SheetState = z.infer<typeof sheetStateSchema>; // from src/shared/api/sheets.ts (Task 10 moves the schema there)
export function getWorkspaceSheet(client, workspaceId): Promise<{ data: SheetStatusDb | null; error: DbError | null }>;
export function turnOffSheet(client, workspaceId): Promise<{ data: ReleasedConnection | null; error: DbError | null }>;
export function retrySheet(client, workspaceId): Promise<{ error: DbError | null }>;
export function startSheet(admin, input: { userId: string; workspaceId: string; connectionId: string; replace: boolean }): Promise<{ data: { started: boolean; released: ReleasedConnection | null } | null; error: DbError | null }>;
export function googleConnectionSaved(admin, input: { userId: string; connectionId: string }): Promise<{ error: DbError | null }>;
export function hitGoogleConnectLimit(client): Promise<{ data: boolean; error: DbError | null }>;
```
- SQL (names later tasks call):
  - `private.sheet_year(timestamptz, text) → integer` (immutable);
  - `private.sheet_mark(uuid[], integer[])`;
  - `private.sheet_mark_all(uuid[])`;
  - `private.connection_in_use(uuid) → boolean`;
  - `private.release_connection(uuid) → jsonb`.

- [ ] **Step 1: Test helper for sheets**

`src/test/db/sheets.ts`:
```ts
import { adminClient } from "./clients";

/** A sheet row as the callback would create it (service role); returns nothing. */
export async function seedSheet(
  workspaceId: string,
  connectionId: string,
  options: { googleSub: string; spreadsheetId?: string | null; status?: "active" | "paused"; pausedReason?: "trashed" | "deleted" | "access_lost" | "full" | null } = { googleSub: "" },
): Promise<void> {
  const { error } = await adminClient()
    .from("sheet_syncs")
    .insert({
      workspace_id: workspaceId,
      connection_id: connectionId,
      google_sub: options.googleSub,
      google_email: "sheets@example.test",
      spreadsheet_id: options.spreadsheetId ?? null,
      status: options.status ?? "active",
      paused_reason: options.pausedReason ?? null,
    });
  if (error) {
    throw error;
  }
}

/** Dirty years of a workspace, newest first (service role). */
export async function dirtyYears(workspaceId: string): Promise<{ year: number; version: number }[]> {
  const { data, error } = await adminClient()
    .from("sheet_dirty_years")
    .select("year, version")
    .eq("workspace_id", workspaceId)
    .order("year", { ascending: false });
  if (error) {
    throw error;
  }
  return data;
}
```

In `src/test/db/sender.ts`, `seedConnection` gets `scopes?: string[]` (default unchanged) and returns `{ id, sub }` instead of the id. Update every caller in the same PR (`grep -rn "seedConnection(" src`; most become `(await seedConnection(…)).id`).

- [ ] **Step 2: Write the failing DB tests**

`src/server/db/sheet-state.db.test.ts` (one file, grouped):
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminClient, createTestUser, expectAppError, type TestUser } from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { seedConnection, setSender } from "@/test/db/sender";
import { dirtyYears, seedSheet } from "@/test/db/sheets";
import { addMember, createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
let owner: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  viewer = await createTestUser({ fullName: "Viewer" });
  workspace = await createWorkspaceAs(owner, "Sheet Club");
  await addMember(workspace.id, viewer.id, "viewer");
});

describe("save_google_connection", () => {
  it("accepts a Sheets-only grant as well as a Gmail one, and nothing else", async () => {
    const save = (scopes: string[]) =>
      adminClient().rpc("save_google_connection", {
        p_user: owner.id,
        p_google_sub: `sub-${crypto.randomUUID()}`,
        p_google_email: "a@example.test",
        p_scopes: scopes,
        p_token_encrypted: "v1.a.b.c",
      });
    expect((await save(["openid", DRIVE_FILE])).error).toBeNull();
    expect((await save(["openid", GMAIL_SEND])).error).toBeNull();
    expect((await save(["openid", "email"])).error?.message).toBe("tn:invalid_input");
  });
});

describe("start_sheet", () => {
  it("creates the sheet row and marks every year with a meeting that asks for answers, plus this year", async () => {
    const { id: connection } = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedMeeting(workspace.id, { status: "scheduled", starts_at: "2024-03-01T17:00:00Z" });
    await seedMeeting(workspace.id, { status: "scheduled", starts_at: "2023-03-01T17:00:00Z", response_mode: "announcement" });
    await seedMeeting(workspace.id, { status: "draft", starts_at: "2022-03-01T17:00:00Z" });
    const { data, error } = await adminClient().rpc("start_sheet", {
      p_user: owner.id, p_workspace: workspace.id, p_connection: connection, p_replace: false,
    });
    expect(error).toBeNull();
    expect(data).toEqual({ started: true, released: null });
    const years = (await dirtyYears(workspace.id)).map((row) => row.year);
    expect(years).toContain(2024);
    expect(years).toContain(new Date().getFullYear());
    expect(years).not.toContain(2023);
    expect(years).not.toContain(2022);
  });

  it("refuses a different Google account for an existing sheet, and reattaches the same one", async () => {
    const first = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, first.id, { googleSub: first.sub, spreadsheetId: "file-abcdefghij", status: "paused", pausedReason: "access_lost" });
    const other = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    const wrong = await adminClient().rpc("start_sheet", { p_user: owner.id, p_workspace: workspace.id, p_connection: other.id, p_replace: false });
    expect(wrong.error?.message).toBe("tn:sheet_wrong_account");
    const same = await adminClient().rpc("start_sheet", { p_user: owner.id, p_workspace: workspace.id, p_connection: first.id, p_replace: false });
    expect(same.data).toEqual({ started: false, released: null });
    const { data } = await adminClient().from("sheet_syncs").select("status, paused_reason").eq("workspace_id", workspace.id).single();
    expect(data).toEqual({ status: "active", paused_reason: null });
  });

  it("replaces a sheet on request and releases the old account when nothing else uses it", async () => {
    const old = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, old.id, { googleSub: old.sub, spreadsheetId: "file-abcdefghij" });
    const fresh = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    const { data } = await adminClient().rpc("start_sheet", { p_user: owner.id, p_workspace: workspace.id, p_connection: fresh.id, p_replace: true });
    expect(data).toMatchObject({ started: true, released: { google_sub: old.sub, user_id: owner.id } });
    const gone = await adminClient().from("google_connections").select("id").eq("id", old.id);
    expect(gone.data).toEqual([]);
  });

  it("is for the workspace's Owner only", async () => {
    const { id } = await seedConnection(viewer.id, { scopes: [DRIVE_FILE] });
    const { error } = await adminClient().rpc("start_sheet", { p_user: viewer.id, p_workspace: workspace.id, p_connection: id, p_replace: false });
    expect(error?.message).toBe("tn:owner_only");
  });
});

describe("the release rule", () => {
  it("Disconnect stops sending everywhere but keeps an account a sheet lives in", async () => {
    const shared = await seedConnection(owner.id, { scopes: [GMAIL_SEND, DRIVE_FILE] });
    await setSender(workspace.id, shared.id);
    await seedSheet(workspace.id, shared.id, { googleSub: shared.sub });
    const { data, error } = await owner.client.rpc("disconnect_google_connection", { p_connection: shared.id });
    expect(error).toBeNull();
    expect(data).toEqual({ released: null, sheets_kept: ["Sheet Club"] });
    const ws = await adminClient().from("workspaces").select("sender_connection_id").eq("id", workspace.id).single();
    expect(ws.data?.sender_connection_id).toBeNull();
  });

  it("Turn off releases an account nothing else uses (owner only)", async () => {
    const solo = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, solo.id, { googleSub: solo.sub });
    await expectAppError(viewer.client.rpc("turn_off_sheet", { p_workspace: workspace.id }), "owner_only");
    const { data } = await owner.client.rpc("turn_off_sheet", { p_workspace: workspace.id });
    expect(data).toMatchObject({ released: { google_sub: solo.sub } });
    expect(await dirtyYears(workspace.id)).toEqual([]);
  });

  it("deleting a workspace releases its sender and its sheet's account when unused", async () => {
    const sender = await seedConnection(owner.id);
    await setSender(workspace.id, sender.id);
    const { data } = await owner.client.rpc("delete_workspace", { p_workspace: workspace.id, p_confirm_name: "Sheet Club" });
    expect(data).toMatchObject({ released: [{ google_sub: sender.sub }] });
  });
});

describe("google_connection_saved (resume rule)", () => {
  it("moves an access-lost sheet on the same Google account to the new connection", async () => {
    const lost = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, lost.id, { googleSub: lost.sub, spreadsheetId: "file-abcdefghij", status: "paused", pausedReason: "access_lost" });
    await adminClient().from("sheet_syncs").update({ connection_id: null }).eq("workspace_id", workspace.id);
    const back = await adminClient().rpc("save_google_connection", {
      p_user: owner.id, p_google_sub: lost.sub, p_google_email: "back@example.test", p_scopes: [DRIVE_FILE], p_token_encrypted: "v1.x.y.z",
    });
    await adminClient().rpc("google_connection_saved", { p_user: owner.id, p_connection: back.data ?? "" });
    const { data } = await adminClient().from("sheet_syncs").select("status, connection_id").eq("workspace_id", workspace.id).single();
    expect(data).toEqual({ status: "active", connection_id: back.data });
  });

  it("pauses an active sheet when the account came back without the Sheets permission", async () => {
    const both = await seedConnection(owner.id, { scopes: [GMAIL_SEND, DRIVE_FILE] });
    await seedSheet(workspace.id, both.id, { googleSub: both.sub, spreadsheetId: "file-abcdefghij" });
    await adminClient().from("google_connections").update({ granted_scopes: [GMAIL_SEND] }).eq("id", both.id);
    await adminClient().rpc("google_connection_saved", { p_user: owner.id, p_connection: both.id });
    const { data } = await adminClient().from("sheet_syncs").select("status, paused_reason").eq("workspace_id", workspace.id).single();
    expect(data).toEqual({ status: "paused", paused_reason: "access_lost" });
  });
});

describe("workspace_sheet and retry_sheet", () => {
  it("tells every member the state, and only the Owner which account holds it", async () => {
    const { id, sub } = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, id, { googleSub: sub, spreadsheetId: "file-abcdefghij" });
    const asOwner = await owner.client.rpc("workspace_sheet", { p_workspace: workspace.id });
    const asViewer = await viewer.client.rpc("workspace_sheet", { p_workspace: workspace.id });
    expect(asOwner.data).toMatchObject({ state: "on", account_email: "sheets@example.test", spreadsheet_id: "file-abcdefghij" });
    expect(asViewer.data).toMatchObject({ state: "on", account_email: null });
  });

  it("says off without a sheet", async () => {
    const { data } = await viewer.client.rpc("workspace_sheet", { p_workspace: workspace.id });
    expect(data).toMatchObject({ state: "off" });
  });

  it("Try again resumes a trashed sheet and marks this year, rate limited, Owner only", async () => {
    const { id, sub } = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, id, { googleSub: sub, spreadsheetId: "file-abcdefghij", status: "paused", pausedReason: "trashed" });
    await expectAppError(viewer.client.rpc("retry_sheet", { p_workspace: workspace.id }), "owner_only");
    expect((await owner.client.rpc("retry_sheet", { p_workspace: workspace.id })).error).toBeNull();
    expect((await dirtyYears(workspace.id)).map((row) => row.year)).toEqual([new Date().getFullYear()]);
  });

  it("never shows another workspace's sheet tables to a member", async () => {
    const { id, sub } = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    await seedSheet(workspace.id, id, { googleSub: sub });
    const stranger = await createTestUser();
    const { data } = await stranger.client.from("sheet_syncs").select("workspace_id");
    expect(data).toEqual([]);
    const dirty = await viewer.client.from("sheet_dirty_years").select("year");
    expect(dirty.error?.code).toBe("42501");
  });
});
```

`new Date().getFullYear()` is the year in the test runner's zone, while the SQL uses the workspace's zone. The test workspace is created by `createWorkspaceAs`, check its time zone there. Near New Year the two can differ, so compute the expected year with `sheetYear(new Date().toISOString(), <workspace timezone>)` instead (import it from `@/lib/sheets/year`).

Run: `supabase db reset --local </dev/null && bun run test:db src/server/db/sheet-state.db.test.ts`
Expected: FAIL. `start_sheet` does not exist, `save_google_connection` rejects Sheets-only scopes, and so on.

- [ ] **Step 3: Write the migration**

`supabase migration new m7_sheet_state`, then:

```sql
-- M7 Google Sheet: state, tabs, change marks, the connection release rule, start and resume
-- (spec §6, §7.17, §9). The worker functions and the change triggers come in the next migration.

insert into private.app_limits (name, value) values
  ('sheet_retries_per_user_per_hour', 20),
  ('google_connects_per_user_per_hour', 20);

create type public.sheet_status as enum ('active', 'paused');
-- Twin: SheetPauseReason (src/emails/owner-alert-email.tsx).
create type public.sheet_pause_reason as enum ('trashed', 'deleted', 'access_lost', 'full');

create table public.sheet_syncs (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  connection_id uuid references public.google_connections (id) on delete set null,
  google_sub text not null check (char_length(google_sub) between 1 and 255),
  google_email text not null check (char_length(google_email) between 3 and 320),
  create_key uuid not null default gen_random_uuid(),
  spreadsheet_id text check (spreadsheet_id is null or spreadsheet_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  status public.sheet_status not null default 'active',
  paused_reason public.sheet_pause_reason,
  paused_at timestamptz,
  alerted_at timestamptz,
  synced_at timestamptz,
  run_id uuid,
  locked_until timestamptz,
  retry_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paused') = (paused_reason is not null))
);
create index sheet_syncs_connection_idx on public.sheet_syncs (connection_id);
create index sheet_syncs_sub_idx on public.sheet_syncs (google_sub);
create trigger sheet_syncs_set_updated_at before update on public.sheet_syncs
  for each row execute function private.set_updated_at();

create table public.sheet_tabs (
  workspace_id uuid not null references public.sheet_syncs (workspace_id) on delete cascade,
  tab_key text not null check (tab_key ~ '^[0-9]{1,6}(-[0-9]{1,4})?$'),
  year integer not null,
  google_sheet_id integer not null,
  title text not null check (char_length(title) between 1 and 100),
  starts_from timestamptz,
  starts_to timestamptz,
  content_hash text not null check (char_length(content_hash) between 1 and 128),
  row_count integer not null check (row_count >= 0),
  format_version integer not null check (format_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, tab_key)
);
create trigger sheet_tabs_set_updated_at before update on public.sheet_tabs
  for each row execute function private.set_updated_at();

create table public.sheet_dirty_years (
  workspace_id uuid not null references public.sheet_syncs (workspace_id) on delete cascade,
  year integer not null,
  version bigint not null default 1,
  changed_at timestamptz not null default now(),
  first_changed_at timestamptz not null default now(),
  primary key (workspace_id, year)
);

alter table public.sheet_syncs enable row level security;
alter table public.sheet_tabs enable row level security;
alter table public.sheet_dirty_years enable row level security;
revoke all on table public.sheet_syncs, public.sheet_tabs, public.sheet_dirty_years from anon, authenticated;
-- Members read the state and tab ids (links); the account, the file tag and the lease stay hidden.
grant select (workspace_id, spreadsheet_id, status, paused_reason, synced_at, created_at)
  on table public.sheet_syncs to authenticated;
grant select (workspace_id, tab_key, year, google_sheet_id, title, starts_from, starts_to)
  on table public.sheet_tabs to authenticated;
grant all on table public.sheet_syncs, public.sheet_tabs, public.sheet_dirty_years to service_role;
create policy sheet_syncs_select_member on public.sheet_syncs
  for select to authenticated using (private.is_member(workspace_id));
create policy sheet_tabs_select_member on public.sheet_tabs
  for select to authenticated using (private.is_member(workspace_id));

-- The year tab a meeting belongs to: its start's year in its own zone. Twin: sheetYear
-- (src/lib/sheets/year.ts).
create function private.sheet_year(p_starts_at timestamptz, p_timezone text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select extract(year from (p_starts_at at time zone p_timezone))::integer
$$;

-- The only writer of sheet_dirty_years: marks (workspace, year) pairs as changed, for workspaces
-- that have a sheet (one index probe otherwise). A new change raises the version, so a write that
-- read an older version leaves the year marked (spec §8).
create function private.sheet_mark(p_workspaces uuid[], p_years integer[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sheet_dirty_years as d (workspace_id, year)
  select distinct y.workspace_id, y.year
  from pg_catalog.unnest(p_workspaces, p_years) as y(workspace_id, year)
  where y.year is not null
    and exists (select 1 from public.sheet_syncs s where s.workspace_id = y.workspace_id)
  on conflict (workspace_id, year) do update
    set version = d.version + 1, changed_at = pg_catalog.now()
$$;

-- Workspace-wide changes (its name, a list's name): every year that has a tab, plus this year.
create function private.sheet_mark_all(p_workspaces uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  select private.sheet_mark(pg_catalog.array_agg(y.workspace_id), pg_catalog.array_agg(y.year))
  from (
    select t.workspace_id, t.year from public.sheet_tabs t where t.workspace_id = any (p_workspaces)
    union
    select w.id, private.sheet_year(pg_catalog.now(), w.timezone)
    from public.workspaces w where w.id = any (p_workspaces)
  ) y
$$;

-- A connection is in use while a workspace sends from it or a sheet lives in it (spec §9).
create function private.connection_in_use(p_connection uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.workspaces w where w.sender_connection_id = p_connection)
    or exists (select 1 from public.sheet_syncs s where s.connection_id = p_connection)
$$;

-- The only place a Google connection is deleted: when nothing uses it any more. Returns what the
-- route needs to revoke the token at Google (null when kept or already gone).
create function private.release_connection(p_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released jsonb;
begin
  if p_connection is null or private.connection_in_use(p_connection) then
    return null;
  end if;
  delete from public.google_connections c
  where c.id = p_connection
  returning pg_catalog.jsonb_build_object(
    'refresh_token_encrypted', c.refresh_token_encrypted, 'google_sub', c.google_sub, 'user_id', c.user_id)
  into v_released;
  return v_released;
end;
$$;

-- save_google_connection: latest body from 20261007174925_m4_save_connection_service_role.sql; a
-- connection exists for sending (gmail.send) or for a sheet (drive.file).
create or replace function private.save_google_connection(
  p_user uuid,
  p_google_sub text,
  p_google_email text,
  p_scopes text[],
  p_token_encrypted text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not (coalesce(p_scopes, '{}') && array['https://www.googleapis.com/auth/gmail.send',
                                             'https://www.googleapis.com/auth/drive.file']) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  insert into public.google_connections (user_id, google_sub, google_email, granted_scopes, refresh_token_encrypted)
  values (p_user, p_google_sub, lower(btrim(p_google_email)), p_scopes, p_token_encrypted)
  on conflict (user_id, google_sub) do update set
    google_email = excluded.google_email,
    granted_scopes = excluded.granted_scopes,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    status = 'active',
    broken_reason = null,
    broken_at = null
  returning id into v_id;
  return v_id;
end;
$$;

-- disconnect_google_connection: was "delete my connection"; now "stop sending from it" everywhere
-- and release it unless a sheet lives in it (spec §9). Returns what to revoke and which sheets keep it.
drop function public.disconnect_google_connection(uuid);
drop function private.disconnect_google_connection(uuid);
create function private.disconnect_google_connection(p_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.google_connections c where c.id = p_connection and c.user_id = auth.uid()
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  update public.workspaces set sender_connection_id = null where sender_connection_id = p_connection;
  return pg_catalog.jsonb_build_object(
    'released', private.release_connection(p_connection),
    'sheets_kept', coalesce((
      select pg_catalog.jsonb_agg(w.name order by w.name)
      from public.sheet_syncs s join public.workspaces w on w.id = s.workspace_id
      where s.connection_id = p_connection
    ), '[]'::jsonb)
  );
end;
$$;
create function public.disconnect_google_connection(p_connection uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.disconnect_google_connection(p_connection) $$;
```

Then:
- **`private.workspace_sender`:** copy the body from `20261007173708_m4_sender.sql` as `create or replace`, and add to each `my_connections` object:
  ```sql
  'sheets', coalesce((select pg_catalog.jsonb_agg(w.name order by w.name) from public.sheet_syncs s join public.workspaces w on w.id = s.workspace_id where s.connection_id = c.id), '[]'::jsonb)
  ```
- **`delete_workspace`:** it changes return type, so drop both, then create `private.delete_workspace(p_workspace uuid, p_confirm_name text) returns jsonb`. Copy the M2 body, plus:

```sql
declare
  v_name text;
  v_connections uuid[];
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  select w.name into v_name from public.workspaces w where w.id = p_workspace for update;
  if btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  select pg_catalog.array_agg(distinct x.id) into v_connections
  from (
    select w.sender_connection_id as id from public.workspaces w where w.id = p_workspace
    union select s.connection_id from public.sheet_syncs s where s.workspace_id = p_workspace
  ) x
  where x.id is not null;
  delete from public.workspaces where id = p_workspace;
  -- Accounts nothing else uses are released; the synced Google Sheet stays in Drive (spec §7.11).
  return pg_catalog.jsonb_build_object('released', coalesce((
    select pg_catalog.jsonb_agg(r.released) from (
      select private.release_connection(c) as released from pg_catalog.unnest(v_connections) as c
    ) r where r.released is not null
  ), '[]'::jsonb));
end;
```

  Its public wrapper: `create function public.delete_workspace(p_workspace uuid, p_confirm_name text) returns jsonb language sql security invoker set search_path = '' as $$ select private.delete_workspace(p_workspace, p_confirm_name) $$;`

Continue the migration with the owner, member and callback functions:

```sql
-- What Settings > Sheets shows (any member); the account email to the Owner only (spec §7.17).
create function private.workspace_sheet(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.workspace_role := private.role_of(p_workspace);
begin
  if v_role is null then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return (
    select pg_catalog.jsonb_build_object(
      'state', case when s.workspace_id is null then 'off' when s.status = 'paused' then 'paused'
                    when s.spreadsheet_id is null then 'creating' else 'on' end,
      'spreadsheet_id', s.spreadsheet_id,
      'paused_reason', s.paused_reason,
      'synced_at', s.synced_at,
      'behind', exists (select 1 from public.sheet_dirty_years d where d.workspace_id = p_workspace),
      'created_at', s.created_at,
      'turned_on_by', coalesce(p.display_name, ''),
      'account_email', case when v_role = 'owner' then s.google_email end,
      'owner_name', coalesce((
        select op.display_name from public.workspace_roles r
        left join public.profiles op on op.user_id = r.user_id
        where r.workspace_id = p_workspace and r.role = 'owner'), ''),
      'tabs', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'year', t.year, 'google_sheet_id', t.google_sheet_id,
          'starts_from', t.starts_from, 'starts_to', t.starts_to)
          order by t.year desc, t.starts_to desc nulls last)
        from public.sheet_tabs t where t.workspace_id = p_workspace), '[]'::jsonb)
    )
    from (select 1) as one
    left join public.sheet_syncs s on s.workspace_id = p_workspace
    left join public.profiles p on p.user_id = s.created_by
  );
end;
$$;

create function private.require_owner(p_workspace uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    if private.is_member(p_workspace) then
      raise exception 'tn:owner_only' using errcode = 'P0001';
    end if;
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
end;
$$;

-- Turn off (Owner): the sheet stops updating, the file stays in Drive, the account is released when
-- nothing else uses it.
create function private.turn_off_sheet(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
begin
  perform private.require_owner(p_workspace);
  delete from public.sheet_syncs where workspace_id = p_workspace returning connection_id into v_connection;
  if not found then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('released', private.release_connection(v_connection));
end;
$$;

-- Try again (Owner, rate limited): redraw now; a sheet paused because its file was trashed resumes
-- (the worker pauses it again if the file is still in the trash).
create function private.retry_sheet(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.sheet_syncs;
begin
  perform private.require_owner(p_workspace);
  select * into v_sheet from public.sheet_syncs where workspace_id = p_workspace for update;
  if v_sheet.workspace_id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if v_sheet.status = 'paused' and v_sheet.paused_reason <> 'trashed' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('sheet_retry') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  update public.sheet_syncs
  set status = 'active', paused_reason = null, paused_at = null, retry_at = pg_catalog.now(), attempts = 0
  where workspace_id = p_workspace;
  perform private.sheet_mark(array[p_workspace],
    array[(select private.sheet_year(pg_catalog.now(), w.timezone) from public.workspaces w where w.id = p_workspace)]);
end;
$$;

-- The connect callback (service role): turn the sheet on, reattach it after "Reconnect Google", or
-- replace it ("Create a new sheet"). A new sheet starts with every year that has answers marked.
create function private.start_sheet(p_user uuid, p_workspace uuid, p_connection uuid, p_replace boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.google_connections;
  v_sheet public.sheet_syncs;
begin
  if not exists (
    select 1 from public.workspace_roles r
    where r.workspace_id = p_workspace and r.user_id = p_user and r.role = 'owner'
  ) then
    raise exception 'tn:owner_only' using errcode = 'P0001';
  end if;
  select * into v_conn from public.google_connections c where c.id = p_connection and c.user_id = p_user;
  if v_conn.id is null or not ('https://www.googleapis.com/auth/drive.file' = any (v_conn.granted_scopes)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  select * into v_sheet from public.sheet_syncs s where s.workspace_id = p_workspace for update;
  if v_sheet.workspace_id is not null and not coalesce(p_replace, false) then
    if v_sheet.google_sub <> v_conn.google_sub then
      raise exception 'tn:sheet_wrong_account' using errcode = 'P0001';
    end if;
    update public.sheet_syncs
    set connection_id = v_conn.id, google_email = v_conn.google_email, retry_at = pg_catalog.now(), attempts = 0,
      status = case when paused_reason = 'access_lost' then 'active'::public.sheet_status else status end,
      paused_at = case when paused_reason = 'access_lost' then null else paused_at end,
      paused_reason = case when paused_reason = 'access_lost' then null else paused_reason end
    where workspace_id = p_workspace;
    perform private.sheet_mark_all(array[p_workspace]);
    return pg_catalog.jsonb_build_object('started', false, 'released', null);
  end if;
  delete from public.sheet_syncs where workspace_id = p_workspace;
  insert into public.sheet_syncs (workspace_id, connection_id, google_sub, google_email, created_by)
  values (p_workspace, v_conn.id, v_conn.google_sub, v_conn.google_email, p_user);
  perform private.sheet_mark(pg_catalog.array_agg(y.workspace_id), pg_catalog.array_agg(y.year))
  from (
    select distinct m.workspace_id, private.sheet_year(m.starts_at, m.timezone) as year
    from public.meetings m
    where m.workspace_id = p_workspace and m.status in ('scheduled', 'cancelled')
      and m.response_mode <> 'announcement' and m.starts_at is not null
    union
    select w.id, private.sheet_year(pg_catalog.now(), w.timezone) from public.workspaces w where w.id = p_workspace
  ) y;
  return pg_catalog.jsonb_build_object(
    'started', true,
    'released', case when v_sheet.connection_id is distinct from v_conn.id
                     then private.release_connection(v_sheet.connection_id) end);
end;
$$;

-- After any successful Google callback (service role): with drive.file, this user's sheets on the
-- same Google account move to this connection (an access-lost one resumes); without it, active
-- sheets on this connection pause (spec §8 Resume).
create function private.google_connection_saved(p_user uuid, p_connection uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.google_connections;
  v_workspaces uuid[];
begin
  select * into v_conn from public.google_connections c where c.id = p_connection and c.user_id = p_user;
  if v_conn.id is null then
    return;
  end if;
  if 'https://www.googleapis.com/auth/drive.file' = any (v_conn.granted_scopes) then
    with moved as (
      update public.sheet_syncs s
      set connection_id = v_conn.id, google_email = v_conn.google_email, status = 'active', paused_reason = null,
        paused_at = null, retry_at = pg_catalog.now(), attempts = 0
      where s.google_sub = v_conn.google_sub
        and (s.status = 'active' or s.paused_reason = 'access_lost')
        and (s.connection_id is distinct from v_conn.id or s.status = 'paused')
        and exists (select 1 from public.workspace_roles r
                    where r.workspace_id = s.workspace_id and r.user_id = p_user and r.role = 'owner')
      returning s.workspace_id
    )
    select pg_catalog.array_agg(moved.workspace_id) into v_workspaces from moved;
    if v_workspaces is not null then
      perform private.sheet_mark_all(v_workspaces);
    end if;
  else
    update public.sheet_syncs
    set status = 'paused', paused_reason = 'access_lost', paused_at = pg_catalog.now()
    where connection_id = v_conn.id and status = 'active';
  end if;
end;
$$;
```

Finish the migration:
- **`hit_user_rate_limit`:** copy the body from `20261009235635_m6_edit_cancel.sql` as `create or replace`, and add `when 'sheet_retry' then 'sheet_retries_per_user_per_hour'` and `when 'google_connect' then 'google_connects_per_user_per_hour'`.
- **The public rate-limit check for the connect route:**
  ```sql
  create function public.hit_google_connect_limit() returns boolean language sql security invoker set search_path = '' as $$ select private.hit_user_rate_limit('google_connect') $$;
  ```
- **Public invoker wrappers** for `workspace_sheet`, `turn_off_sheet`, `retry_sheet`, `start_sheet` and `google_connection_saved`, the same signatures each calling its private twin.
- **Grants:**

```sql
revoke execute on function
  private.sheet_year(timestamptz, text), private.sheet_mark(uuid[], integer[]), private.sheet_mark_all(uuid[]),
  private.connection_in_use(uuid), private.release_connection(uuid), private.require_owner(uuid),
  private.start_sheet(uuid, uuid, uuid, boolean), private.google_connection_saved(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  private.workspace_sheet(uuid), private.turn_off_sheet(uuid), private.retry_sheet(uuid),
  private.disconnect_google_connection(uuid), private.delete_workspace(uuid, text)
to authenticated;
revoke execute on function private.workspace_sheet(uuid), private.turn_off_sheet(uuid), private.retry_sheet(uuid),
  private.disconnect_google_connection(uuid), private.delete_workspace(uuid, text) from public, anon;
grant execute on function private.start_sheet(uuid, uuid, uuid, boolean), private.google_connection_saved(uuid, uuid) to service_role;
revoke execute on function public.workspace_sheet(uuid), public.turn_off_sheet(uuid), public.retry_sheet(uuid),
  public.disconnect_google_connection(uuid), public.delete_workspace(uuid, text), public.hit_google_connect_limit(),
  public.start_sheet(uuid, uuid, uuid, boolean), public.google_connection_saved(uuid, uuid)
from public, anon;
grant execute on function public.workspace_sheet(uuid), public.turn_off_sheet(uuid), public.retry_sheet(uuid),
  public.disconnect_google_connection(uuid), public.delete_workspace(uuid, text), public.hit_google_connect_limit()
to authenticated;
revoke execute on function public.start_sheet(uuid, uuid, uuid, boolean), public.google_connection_saved(uuid, uuid) from authenticated;
grant execute on function public.start_sheet(uuid, uuid, uuid, boolean), public.google_connection_saved(uuid, uuid) to service_role;
```

`private.require_owner` is called by definer functions, so it needs no grant to `authenticated`.

Check that the helpers run inside `private` definer functions owned by `postgres`. They do: they're called from definer bodies. The M2–M6 migrations follow the same pattern.

- [ ] **Step 4: Run the DB tests**

```bash
supabase db reset --local </dev/null && bun run db:types && bun run test:db src/server/db/sheet-state.db.test.ts
```
Expected: PASS.

Then add to `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`, keeping the list sorted:
- `retry_sheet`, `turn_off_sheet`, `workspace_sheet`;
- `delete_workspace` and `disconnect_google_connection` are already listed.

Run: `bun run test:db src/server/db/function-security.db.test.ts`
Expected: PASS.

- [ ] **Step 5: `revokeReleased`, with its failing test first**

`src/server/google/release.test.ts`:
```ts
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionAssociatedData, sealSecret } from "@/server/crypto/secret-box";

const KEY = randomBytes(32);
const mocks = vi.hoisted(() => ({ revoke: vi.fn(async () => true) }));
vi.mock("@/config/env", () => ({ getServerEnv: () => ({ GOOGLE_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"), LOG_LEVEL: "info" }) }));
vi.mock("@/server/google/google-oauth", () => ({ revokeGoogleToken: mocks.revoke }));

const { releasedSchema, revokeReleased } = await import("./release");

beforeEach(() => vi.clearAllMocks());

describe("revokeReleased", () => {
  it("opens each released token with its own owner and account, and revokes it", async () => {
    const sealed = sealSecret("1//rt", KEY, connectionAssociatedData("user-1", "g-1"));
    const released = releasedSchema.parse({ refresh_token_encrypted: sealed, google_sub: "g-1", user_id: "user-1" });
    await revokeReleased([released, null]);
    expect(mocks.revoke).toHaveBeenCalledWith("1//rt");
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
  });

  it("never throws, even when a token can't be opened", async () => {
    await expect(revokeReleased([{ tokenEncrypted: "v1.bad.bad.bad", googleSub: "g", userId: "u" }])).resolves.toBeUndefined();
  });
});
```

Run it. Expected: FAIL (module missing). Then write `release.ts`:

```ts
import "server-only";
import { z } from "zod";
import { getServerEnv } from "@/config/env";
import { requireSecret } from "@/config/secrets";
import { logger } from "@/lib/logger";
import { connectionAssociatedData, openSecret, parseEncryptionKey } from "@/server/crypto/secret-box";
import { revokeGoogleToken } from "./google-oauth";

/** A Google connection the database deleted because nothing uses it any more (spec §9). */
export type ReleasedConnection = { tokenEncrypted: string; googleSub: string; userId: string };

/** `private.release_connection`'s result (null: kept or already gone). */
export const releasedSchema = z
  .object({ refresh_token_encrypted: z.string(), google_sub: z.string(), user_id: z.uuid().or(z.string().min(1)) })
  .nullable()
  .transform((db): ReleasedConnection | null =>
    db ? { tokenEncrypted: db.refresh_token_encrypted, googleSub: db.google_sub, userId: db.user_id } : null,
  );

/**
 * Revokes released connections at Google (best effort; Google's revoke removes every permission of
 * that grant). Never throws; logs counts only.
 */
export async function revokeReleased(released: ReadonlyArray<ReleasedConnection | null>): Promise<void> {
  const targets = released.filter((item): item is ReleasedConnection => item !== null);
  if (targets.length === 0) {
    return;
  }
  let failed = 0;
  try {
    const key = parseEncryptionKey(requireSecret("GOOGLE_TOKEN_ENCRYPTION_KEY", getServerEnv()));
    for (const target of targets) {
      try {
        const token = openSecret(target.tokenEncrypted, key, connectionAssociatedData(target.userId, target.googleSub));
        if (!(await revokeGoogleToken(token))) {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  } catch {
    failed = targets.length;
  }
  if (failed > 0) {
    logger.warn({ failed, total: targets.length }, "Google did not confirm every token revocation");
  }
}
```

Use `z.uuid()` alone if the test ids are uuids; the test above uses `"user-1"`, so either change the test to real uuids (preferred) or keep the `or`. Prefer real uuids and plain `z.uuid()`.

Run: `bun run test src/server/google/release.test.ts`
Expected: PASS.

- [ ] **Step 6: Queries and routes that changed shape (failing route tests first)**

1. **`src/server/queries/sender.ts`:**
   - `disconnectGoogleConnection` parses `{ released: releasedSchema, sheets_kept: z.array(z.string()) }` and returns `{ released, sheetsKept }`;
   - `dbSenderSchema.my_connections[]` gains `sheets: z.array(z.string())`, mapped to `sheets`;
   - `src/shared/api/sender.ts` adds `sheets: z.array(z.string())` to `myConnections`.
2. **`connections/[id]/route.ts`:** after `disconnectGoogleConnection`, call `await revokeReleased([data.released])` (this replaces the inline revocation code) and return `ok()`. Update its test:
   - "revokes the token when the connection is released";
   - "keeps the token when a Google Sheet still uses the account" (`released: null` → `revoke` not called).
3. **`src/server/queries/members.ts`:** `deleteWorkspace` parses `{ released: z.array(releasedSchema) }`.
4. **`DELETE /api/workspaces/[slug]`:** calls `revokeReleased(data.released)` after a successful delete. Add a route test "revokes the accounts a deleted workspace released".
5. **`src/server/queries/sheets.ts`:** `getWorkspaceSheet`, `turnOffSheet`, `retrySheet`, `startSheet`, `googleConnectionSaved`, `hitGoogleConnectLimit`, each a thin `client.rpc(...)` with Zod parsing of the jsonb.
   - The status schema is temporary here: `z.object({ state: z.enum(["off", "creating", "on", "paused"]), … })`. Task 10 moves it to `src/shared/api/sheets.ts`; write it there now if that is simpler, and Task 10 only adds to it.
6. **`sheet_wrong_account`:** add it to `API_ERROR_CODES` (409) and to `messages/en.json` `ApiErrors`.

Run: `bun run test "src/app/api/integrations" "src/app/api/workspaces/\[slug\]/route"` and `bun run typecheck`.
Expected: PASS.

- [ ] **Step 7: Full check, advisors, commit, PR, merge, hosted push**

```bash
bunx prettier --write src && bun run format:check && bun run lint && bun run typecheck && bun run test \
  && supabase db reset --local </dev/null && bun run test:db && supabase db advisors --local </dev/null
```
Expected: all pass; the advisors show only the pre-existing auth WARN.

```bash
git checkout -b feat/<issue>-m7-sheet-state
git add supabase/migrations src
git commit -m "feat(db): Google Sheet state, release rule, start and resume"
```
PR with `Closes #<issue>`, labels `type:task`, `area:db`, `area:api`. Run `merge-when-green.sh`, confirm `MERGED`, then **`hosted-push.sh`**.

---
### Task 7: DB: change triggers, worker functions, wake-up, housekeeping

**Labels:** `type:task`, `area:db`, `area:pipeline`.

**Files:**
- Create: `supabase/migrations/<ts>_m7_sheet_worker.sql`, `src/server/db/sheet-worker.db.test.ts`
- Modify: `src/server/db/database.types.ts` (regenerated), `src/test/db/sheets.ts` (+ `makeDue`)

**Interfaces:**
- Consumes (Task 6): `private.sheet_year`, `private.sheet_mark`, `private.sheet_mark_all`, and the tables.
- Produces. Task 8's store calls these service-role RPCs by these names:
  - `sheet_claim(p_run uuid, p_limit integer, p_lease_seconds integer) → jsonb` returns an array of:
    `{ workspace_id, workspace_name, workspace_slug, timezone, locale, spreadsheet_id, create_key, connection: { id, user_id, google_sub, refresh_token_encrypted, granted_scopes } | null, years: [{ year, version }] (newest first), tabs: [{ tab_key, year, google_sheet_id, title, content_hash, row_count, format_version }] }`
  - `sheet_rows(p_workspace uuid, p_year integer) → jsonb`: rows shaped like `attendance_details` items plus `meeting_status`, `lists` (text[]); ordered `starts_at desc, meeting_id, sort_name, invitee_id`.
  - `sheet_save_file(p_workspace, p_run, p_spreadsheet_id) → boolean`
  - `sheet_save_tab(p_workspace, p_run, p_tab jsonb) → boolean`; `p_tab` = `{ tab_key, year, google_sheet_id, title, starts_from, starts_to, content_hash, row_count, format_version }`
  - `sheet_drop_tabs(p_workspace, p_run, p_keys text[]) → void`
  - `sheet_finish_year(p_workspace, p_run, p_year, p_version) → boolean` (true when cleared)
  - `sheet_release(p_workspace, p_run, p_synced boolean) → void`
  - `sheet_retry(p_workspace, p_run, p_error text) → void`
  - `sheet_pause(p_workspace, p_run, p_reason public.sheet_pause_reason) → jsonb` returns `{ email, workspace_name, workspace_slug, reason } | null`
- Helpers:
  - `private.sheet_due(public.sheet_syncs) → boolean`
  - `private.job_held(public.job_kind, uuid) → boolean`
  - `private.workers_due() → boolean` (what the wake-up checks)
  - `private.sheet_mark_meetings(uuid[])`, `private.sheet_mark_contacts(uuid[])`

- [ ] **Step 1: Test helper**

Add to `src/test/db/sheets.ts`:
```ts
/** Makes a workspace's marked years due now (as if the 1-minute quiet time had passed). */
export function makeDue(workspaceId: string): void {
  runLocalSql(
    `update public.sheet_dirty_years set changed_at = now() - interval '2 minutes', first_changed_at = now() - interval '2 minutes' where workspace_id = '${workspaceId}'`,
  );
}
```
(import `runLocalSql` from `./sql`). `workspaceId` is always a uuid from the test's own setup.

- [ ] **Step 2: Write the failing DB tests**

`src/server/db/sheet-worker.db.test.ts` (groups):
1. **Marks (triggers).** Each case has its own setup: a workspace with a sheet, plus one scheduled meeting in 2026 with two invitees (`seedMeeting` + `seedContacts` + `seedInvitee`). Each case clears `sheet_dirty_years` for the workspace first, then expects:
   - an answer through `token_submit_response` → `[2026]`, version 1, then version 2 after a second answer;
   - a check-in through `mark_attendance` (the meeting moved to the past by service role first) → `[2026]`;
   - renaming a contact that was invited → `[2026]`; renaming one never invited → `[]`;
   - a list rename → every tab year (seed a `sheet_tabs` row for 2025) plus the current year;
   - adding the contact to a list → `[2026]`;
   - moving the meeting from 2026-12-31 to 2027-01-02 (service role update of `starts_at`) → `[2027, 2026]`;
   - editing a **draft** meeting → `[]`;
   - deleting the meeting → `[2026]`;
   - deleting the whole workspace (with a sheet) succeeds (no FK error).
2. **The trigger stays out of the way:** in a second workspace **without** a sheet, an answer, an import of 50 contacts and a meeting edit all succeed, and `sheet_dirty_years` has no row for it (`select count(*)` = 0).
3. **`sheet_claim`:**
   - a sheet whose year changed just now is **not** claimed;
   - after `makeDue` it is claimed, with `years` and `connection` filled;
   - a second claim while leased returns `[]`;
   - a sheet with `first_changed_at` 6 minutes ago and `changed_at` now **is** claimed (the 5-minute cap);
   - a new sheet without a file is claimed at once;
   - a paused one is never claimed;
   - one with `retry_at` in the future is not claimed.
4. **`sheet_finish_year`:**
   - after a claim of version 1, a new answer (version 2) arrives → `finish(…, 1)` returns false and the year stays;
   - `finish(…, 2)` clears it;
   - a call with a run id that holds no lease changes nothing.
5. **`sheet_retry`:** `retry_at` grows 1, 2, 4… minutes (each within +30 s of jitter) and never passes 30 minutes; the lease is freed.
6. **`sheet_pause`:**
   - returns the Owner's email and reason the first time;
   - a second pause within 24 h returns null;
   - the sheet is paused with the reason.
7. **`sheet_rows`:**
   - order is newest meeting first, then name;
   - a cancelled meeting is included (`meeting_status = "cancelled"`), an announcement is not, a draft is not;
   - a meeting at `2026-12-31T23:30Z` in `Africa/Tunis` belongs to 2027;
   - `lists` holds the contact's list names sorted like the roster;
   - `answer` and `mark` have the `attendance_details` shape.
8. **`workers_due`:**
   - false with nothing due;
   - true with a due invite;
   - **false** with only an update job held behind a queued invite (the #255 every-minute wake);
   - true with a due sheet.
9. **Plans:** with 2,000 contacts and 1,000 invitees seeded in one meeting of the sheet's workspace and `analyze` run, `explainCall("public.sheet_rows('<ws>', 2026)", owner.id)` scans `meetings_workspace_starts_idx`.
   - `sheet_rows` is service-role only, so run the explain as the `service_role` role: add an optional `role` parameter to `explainCall` (default `authenticated`) and pass `"service_role"`.

Write each as an `it(...)` in the file's style (see `src/server/db/sheet-state.db.test.ts` from Task 6).

Run: `supabase db reset --local </dev/null && bun run test:db src/server/db/sheet-worker.db.test.ts`
Expected: FAIL (functions missing, no marks).

- [ ] **Step 3: Write the migration**

`supabase migration new m7_sheet_worker`:

```sql
-- M7 Google Sheet worker (spec §8): change marks, the claim and write functions, one "is it due"
-- rule per worker, the shared wake-up, and the daily repair mark.

insert into private.app_limits (name, value) values
  ('sheet_quiet_seconds', 60),
  ('sheet_max_wait_seconds', 300),
  ('sheet_retry_max_minutes', 30);

alter table public.sheet_syncs
  add column last_error text check (last_error is null or char_length(last_error) <= 200);
create index sheet_syncs_due_idx on public.sheet_syncs (retry_at) where status = 'active';

-- Marks the years of these meetings (sent ones that ask for answers).
create function private.sheet_mark_meetings(p_meetings uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  select private.sheet_mark(pg_catalog.array_agg(m.workspace_id), pg_catalog.array_agg(private.sheet_year(m.starts_at, m.timezone)))
  from public.meetings m
  where m.id = any (p_meetings) and m.status <> 'draft' and m.response_mode <> 'announcement' and m.starts_at is not null
$$;

-- Marks the years of every meeting these contacts were invited to.
create function private.sheet_mark_contacts(p_contacts uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  select private.sheet_mark_meetings(pg_catalog.array_agg(distinct i.meeting_id))
  from public.meeting_invitees i
  where i.contact_id = any (p_contacts)
$$;

-- One trigger function per table; transition tables need one trigger per event, so each function
-- branches on TG_OP (PL/pgSQL plans a statement only when it runs, so the unused table names are fine).
-- Every function returns early while no workspace has a sheet.

create function private.sheet_meetings_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_OP = 'DELETE' then
    perform private.sheet_mark(pg_catalog.array_agg(o.workspace_id), pg_catalog.array_agg(private.sheet_year(o.starts_at, o.timezone)))
    from old_rows o
    where o.status <> 'draft' and o.response_mode <> 'announcement' and o.starts_at is not null;
  else
    perform private.sheet_mark(pg_catalog.array_agg(x.workspace_id), pg_catalog.array_agg(x.year))
    from (
      select o.workspace_id, private.sheet_year(o.starts_at, o.timezone) as year
      from old_rows o join new_rows n on n.id = o.id
      where (o.title, o.starts_at, o.timezone, o.status) is distinct from (n.title, n.starts_at, n.timezone, n.status)
        and o.status <> 'draft' and o.response_mode <> 'announcement' and o.starts_at is not null
      union all
      select n.workspace_id, private.sheet_year(n.starts_at, n.timezone)
      from old_rows o join new_rows n on n.id = o.id
      where (o.title, o.starts_at, o.timezone, o.status) is distinct from (n.title, n.starts_at, n.timezone, n.status)
        and n.status <> 'draft' and n.response_mode <> 'announcement' and n.starts_at is not null
    ) x;
  end if;
  return null;
end;
$$;
create trigger sheet_meetings_updated after update on public.meetings
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.sheet_meetings_changed();
create trigger sheet_meetings_deleted after delete on public.meetings
  referencing old table as old_rows
  for each statement execute function private.sheet_meetings_changed();

-- Invitees: added, removed, or their email status changed.
create function private.sheet_invitees_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_OP = 'INSERT' then
    perform private.sheet_mark_meetings(array(select distinct n.meeting_id from new_rows n));
  elsif TG_OP = 'DELETE' then
    perform private.sheet_mark_meetings(array(select distinct o.meeting_id from old_rows o));
  else
    perform private.sheet_mark_meetings(array(
      select distinct n.meeting_id from new_rows n join old_rows o on o.id = n.id
      where o.email_status is distinct from n.email_status));
  end if;
  return null;
end;
$$;
create trigger sheet_invitees_inserted after insert on public.meeting_invitees
  referencing new table as new_rows for each statement execute function private.sheet_invitees_changed();
create trigger sheet_invitees_updated after update on public.meeting_invitees
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_invitees_changed();
create trigger sheet_invitees_deleted after delete on public.meeting_invitees
  referencing old table as old_rows for each statement execute function private.sheet_invitees_changed();

-- Answers and check-ins: any write.
create function private.sheet_rows_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_OP = 'DELETE' then
    perform private.sheet_mark_meetings(array(select distinct o.meeting_id from old_rows o));
  else
    perform private.sheet_mark_meetings(array(select distinct n.meeting_id from new_rows n));
  end if;
  return null;
end;
$$;
create trigger sheet_responses_inserted after insert on public.responses
  referencing new table as new_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_responses_updated after update on public.responses
  referencing new table as new_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_responses_deleted after delete on public.responses
  referencing old table as old_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_marks_inserted after insert on public.attendance_marks
  referencing new table as new_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_marks_updated after update on public.attendance_marks
  referencing new table as new_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_marks_deleted after delete on public.attendance_marks
  referencing old table as old_rows for each statement execute function private.sheet_rows_changed();

-- Contacts: name or email (deleting one cascades to its invitees, whose trigger marks).
create function private.sheet_contacts_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  perform private.sheet_mark_contacts(array(
    select n.id from new_rows n join old_rows o on o.id = n.id
    where (o.full_name, o.email) is distinct from (n.full_name, n.email)));
  return null;
end;
$$;
create trigger sheet_contacts_updated after update on public.contacts
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_contacts_changed();

-- List memberships (the Lists column).
create function private.sheet_memberships_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_OP = 'DELETE' then
    perform private.sheet_mark_contacts(array(select distinct o.contact_id from old_rows o));
  else
    perform private.sheet_mark_contacts(array(select distinct n.contact_id from new_rows n));
  end if;
  return null;
end;
$$;
create trigger sheet_memberships_inserted after insert on public.list_contacts
  referencing new table as new_rows for each statement execute function private.sheet_memberships_changed();
create trigger sheet_memberships_deleted after delete on public.list_contacts
  referencing old table as old_rows for each statement execute function private.sheet_memberships_changed();

-- A list's name or the workspace's name: every year that has a tab.
create function private.sheet_names_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_TABLE_NAME = 'lists' then
    perform private.sheet_mark_all(array(
      select distinct n.workspace_id from new_rows n join old_rows o on o.id = n.id where o.name is distinct from n.name));
  else
    perform private.sheet_mark_all(array(
      select n.id from new_rows n join old_rows o on o.id = n.id where o.name is distinct from n.name));
  end if;
  return null;
end;
$$;
create trigger sheet_lists_updated after update on public.lists
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_names_changed();
create trigger sheet_workspaces_updated after update on public.workspaces
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_names_changed();

-- "Is this sheet due?" (spec §8): active, not leased, past its retry time, and either without a
-- file yet or with a year that changed at least a quiet minute ago (or first changed 5 minutes ago).
create function private.sheet_due(p_sheet public.sheet_syncs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_sheet.status = 'active'
    and (p_sheet.locked_until is null or p_sheet.locked_until < pg_catalog.now())
    and p_sheet.retry_at <= pg_catalog.now()
    and (p_sheet.spreadsheet_id is null or exists (
      select 1 from public.sheet_dirty_years d
      where d.workspace_id = p_sheet.workspace_id
        and (d.changed_at <= pg_catalog.now() - pg_catalog.make_interval(secs => private.app_limit('sheet_quiet_seconds'))
          or d.first_changed_at <= pg_catalog.now() - pg_catalog.make_interval(secs => private.app_limit('sheet_max_wait_seconds')))))
$$;

-- An update or a cancellation waits for that person's invite, still being sent (M6). One rule for
-- dispatch_claim and the wake-up.
create function private.job_held(p_kind public.job_kind, p_invitee uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_kind in ('update', 'cancel') and exists (
    select 1 from public.meeting_invitees qi where qi.id = p_invitee and qi.email_status = 'queued')
$$;

-- What the per-minute wake-up checks: an email job due (and not held), an expired lease, or a sheet due.
create function private.workers_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.outbox_jobs j
      where (j.status = 'pending' and j.run_after <= pg_catalog.now() and not private.job_held(j.kind, j.invitee_id))
        or (j.status = 'processing' and j.locked_until < pg_catalog.now()))
    or exists (select 1 from public.sheet_syncs s where private.sheet_due(s))
$$;
```

Then:
- **`private.kick_dispatcher()`:** copy from `20261007205641_m4_outbox.sql` as `create or replace`, and replace its `if not exists (select 1 from public.outbox_jobs …) then return; end if;` block with `if not private.workers_due() then return; end if;`.
- **`public.dispatch_claim(...)`:** copy from `20261009235635_m6_edit_cancel.sql` as `create or replace`. Replace **both** inline blocks
  ```sql
  and not (j.kind in ('update', 'cancel') and exists (
    select 1 from public.meeting_invitees qi where qi.id = j.invitee_id and qi.email_status = 'queued'))
  ```
  with `and not private.job_held(j.kind, j.invitee_id)`, and keep the comment above each.
- **`private.housekeeping()`:** copy from `20261007205641_m4_outbox.sql` and add before `end;`:

```sql
  -- The current year of every sheet is redrawn once a day, so edits made in the sheet are repaired.
  perform private.sheet_mark(pg_catalog.array_agg(s.workspace_id), pg_catalog.array_agg(private.sheet_year(pg_catalog.now(), w.timezone)))
  from public.sheet_syncs s join public.workspaces w on w.id = s.workspace_id
  where s.spreadsheet_id is not null;
```

Worker functions:

```sql
create function public.sheet_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with picked as (
    select s.workspace_id from public.sheet_syncs s
    where s.status = 'active' and private.sheet_due(s)
    order by s.retry_at
    limit p_limit
    for update of s skip locked
  ), leased as (
    update public.sheet_syncs s
    set run_id = p_run, locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    from picked where s.workspace_id = picked.workspace_id
    returning s.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'workspace_id', l.workspace_id, 'workspace_name', w.name, 'workspace_slug', w.slug,
    'timezone', w.timezone, 'locale', w.locale, 'spreadsheet_id', l.spreadsheet_id, 'create_key', l.create_key,
    'connection', case when c.id is null then null else pg_catalog.jsonb_build_object(
      'id', c.id, 'user_id', c.user_id, 'google_sub', c.google_sub,
      'refresh_token_encrypted', c.refresh_token_encrypted, 'granted_scopes', c.granted_scopes) end,
    'years', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('year', d.year, 'version', d.version) order by d.year desc)
      from public.sheet_dirty_years d where d.workspace_id = l.workspace_id), '[]'::jsonb),
    'tabs', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'tab_key', t.tab_key, 'year', t.year, 'google_sheet_id', t.google_sheet_id, 'title', t.title,
        'content_hash', t.content_hash, 'row_count', t.row_count, 'format_version', t.format_version)
        order by t.year desc, t.tab_key)
      from public.sheet_tabs t where t.workspace_id = l.workspace_id), '[]'::jsonb)
  )), '[]'::jsonb)
  into v_rows
  from leased l
  join public.workspaces w on w.id = l.workspace_id
  left join public.google_connections c on c.id = l.connection_id;
  return v_rows;
end;
$$;

-- One year's rows (spec §7.17): the Attendance Details shape plus the meeting's status and the
-- person's list names (sorted like the roster), newest meeting first, then name.
create function public.sheet_rows(p_workspace uuid, p_year integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with lists as (
    select lc.contact_id, pg_catalog.array_agg(l.name order by lower(l.name)) as names
    from public.list_contacts lc join public.lists l on l.id = lc.list_id
    where lc.workspace_id = p_workspace
    group by lc.contact_id
  ), sheet as (
    select m.id as meeting_id, m.title, m.starts_at, m.timezone, m.response_mode, m.status as meeting_status,
      i.id as invitee_id, c.id as contact_id, c.full_name, c.email, lower(c.full_name) as sort_name, i.email_status,
      case when r.id is null then null else pg_catalog.jsonb_build_object(
        'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
        'after_deadline', r.after_deadline, 'updated_at', r.updated_at,
        'needs_reconfirmation', r.needs_reconfirmation) end as answer,
      private.mark_json(am, mp.display_name) as mark,
      coalesce(ls.names, '{}'::text[]) as lists
    from public.meetings m
    join public.meeting_invitees i on i.meeting_id = m.id
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    left join public.attendance_marks am on am.invitee_id = i.id
    left join public.profiles mp on mp.user_id = am.marked_by
    left join lists ls on ls.contact_id = c.id
    where m.workspace_id = p_workspace and m.status in ('scheduled', 'cancelled') and m.response_mode <> 'announcement'
      and m.starts_at >= pg_catalog.make_timestamptz(p_year, 1, 1, 0, 0, 0, 'UTC') - interval '1 day'
      and m.starts_at < pg_catalog.make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'UTC') + interval '1 day'
      and private.sheet_year(m.starts_at, m.timezone) = p_year
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(sheet)
    order by sheet.starts_at desc, sheet.meeting_id, sheet.sort_name, sheet.invitee_id), '[]'::jsonb)
  from sheet
$$;

create function public.sheet_save_file(p_workspace uuid, p_run uuid, p_spreadsheet_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.sheet_syncs set spreadsheet_id = p_spreadsheet_id
  where workspace_id = p_workspace and run_id = p_run;
  return found;
end;
$$;

create function public.sheet_save_tab(p_workspace uuid, p_run uuid, p_tab jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs s where s.workspace_id = p_workspace and s.run_id = p_run) then
    return false;
  end if;
  insert into public.sheet_tabs (workspace_id, tab_key, year, google_sheet_id, title, starts_from, starts_to,
    content_hash, row_count, format_version)
  values (p_workspace, p_tab ->> 'tab_key', (p_tab ->> 'year')::integer, (p_tab ->> 'google_sheet_id')::integer,
    p_tab ->> 'title', (p_tab ->> 'starts_from')::timestamptz, (p_tab ->> 'starts_to')::timestamptz,
    p_tab ->> 'content_hash', (p_tab ->> 'row_count')::integer, (p_tab ->> 'format_version')::integer)
  on conflict (workspace_id, tab_key) do update set
    year = excluded.year, google_sheet_id = excluded.google_sheet_id, title = excluded.title,
    starts_from = excluded.starts_from, starts_to = excluded.starts_to, content_hash = excluded.content_hash,
    row_count = excluded.row_count, format_version = excluded.format_version;
  return true;
end;
$$;

create function public.sheet_drop_tabs(p_workspace uuid, p_run uuid, p_keys text[])
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.sheet_tabs t
  where t.workspace_id = p_workspace and t.tab_key = any (p_keys)
    and exists (select 1 from public.sheet_syncs s where s.workspace_id = p_workspace and s.run_id = p_run)
$$;

-- Clears a year only if nothing changed since the claim read it (spec §8): a change during the write
-- raised the version, so the year stays marked and the next run redraws it.
create function public.sheet_finish_year(p_workspace uuid, p_run uuid, p_year integer, p_version bigint)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.sheet_dirty_years d
  where d.workspace_id = p_workspace and d.year = p_year and d.version = p_version
    and exists (select 1 from public.sheet_syncs s where s.workspace_id = p_workspace and s.run_id = p_run);
  return found;
end;
$$;

create function public.sheet_release(p_workspace uuid, p_run uuid, p_synced boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.sheet_syncs
  set run_id = null, locked_until = null,
    synced_at = case when p_synced then pg_catalog.now() else synced_at end,
    attempts = case when p_synced then 0 else attempts end,
    last_error = case when p_synced then null else last_error end
  where workspace_id = p_workspace and run_id = p_run
$$;

-- Backoff after a Google error or a 429: 1, 2, 4… minutes up to sheet_retry_max_minutes, plus up to
-- 30 s of jitter (Sheets API usage limits: exponential backoff).
create function public.sheet_retry(p_workspace uuid, p_run uuid, p_error text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.sheet_syncs
  set attempts = attempts + 1, last_error = left(p_error, 200), run_id = null, locked_until = null,
    retry_at = pg_catalog.now()
      + pg_catalog.make_interval(mins => least(private.app_limit('sheet_retry_max_minutes'), (2 ^ least(attempts, 10))::integer))
      + pg_catalog.make_interval(secs => pg_catalog.random() * 30)
  where workspace_id = p_workspace and run_id = p_run
$$;

-- Pause with a reason (spec §7.17); one platform email per pause (no second one within 24 h), on
-- the same platform budget as the M4 sender alert.
create function private.sheet_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.sheet_syncs;
begin
  update public.sheet_syncs
  set status = 'paused', paused_reason = p_reason, paused_at = pg_catalog.now(), run_id = null, locked_until = null
  where workspace_id = p_workspace and run_id = p_run
  returning * into v_sheet;
  if v_sheet.workspace_id is null
    or (v_sheet.alerted_at is not null and v_sheet.alerted_at > pg_catalog.now() - interval '24 hours')
    or not private.hit_rate_limit('invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours') then
    return null;
  end if;
  update public.sheet_syncs set alerted_at = pg_catalog.now() where workspace_id = p_workspace;
  return (
    select pg_catalog.jsonb_build_object('email', u.email, 'workspace_name', w.name, 'workspace_slug', w.slug, 'reason', p_reason)
    from public.workspaces w
    join public.workspace_roles r on r.workspace_id = w.id and r.role = 'owner'
    join auth.users u on u.id = r.user_id
    where w.id = p_workspace
  );
end;
$$;
create function public.sheet_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.sheet_pause(p_workspace, p_run, p_reason) $$;
```

Finish with the grants:

```sql
revoke execute on function
  private.sheet_mark_meetings(uuid[]), private.sheet_mark_contacts(uuid[]),
  private.sheet_meetings_changed(), private.sheet_invitees_changed(), private.sheet_rows_changed(),
  private.sheet_contacts_changed(), private.sheet_memberships_changed(), private.sheet_names_changed(),
  private.sheet_due(public.sheet_syncs), private.job_held(public.job_kind, uuid), private.workers_due(),
  private.sheet_pause(uuid, uuid, public.sheet_pause_reason)
from public, anon, authenticated;
-- The invoker worker and dispatcher functions run as the service role.
grant execute on function private.sheet_due(public.sheet_syncs), private.job_held(public.job_kind, uuid),
  private.sheet_pause(uuid, uuid, public.sheet_pause_reason) to service_role;
revoke execute on function
  public.sheet_claim(uuid, integer, integer), public.sheet_rows(uuid, integer),
  public.sheet_save_file(uuid, uuid, text), public.sheet_save_tab(uuid, uuid, jsonb),
  public.sheet_drop_tabs(uuid, uuid, text[]), public.sheet_finish_year(uuid, uuid, integer, bigint),
  public.sheet_release(uuid, uuid, boolean), public.sheet_retry(uuid, uuid, text),
  public.sheet_pause(uuid, uuid, public.sheet_pause_reason)
from public, anon, authenticated;
grant execute on function
  public.sheet_claim(uuid, integer, integer), public.sheet_rows(uuid, integer),
  public.sheet_save_file(uuid, uuid, text), public.sheet_save_tab(uuid, uuid, jsonb),
  public.sheet_drop_tabs(uuid, uuid, text[]), public.sheet_finish_year(uuid, uuid, integer, bigint),
  public.sheet_release(uuid, uuid, boolean), public.sheet_retry(uuid, uuid, text),
  public.sheet_pause(uuid, uuid, public.sheet_pause_reason)
to service_role;
```

Check that the service role can execute `private.mark_json`, `private.sheet_year` and `private.app_limit`. They are called inside the invoker `sheet_rows` / `sheet_retry` / `sheet_due`. If `select has_function_privilege('service_role', 'private.mark_json(public.attendance_marks, text)', 'execute')` (and the same for the others) is false, add `grant execute … to service_role` for exactly those.

- [ ] **Step 4: Run the DB tests**

```bash
supabase db reset --local </dev/null && bun run db:types && bun run test:db
```
Expected: PASS, including every existing dispatcher test (the claim rewrite must not change behaviour).

Then run `supabase db advisors --local </dev/null`. Expected: only the pre-existing WARN.

- [ ] **Step 5: Commit, PR, merge, hosted push**

```bash
git checkout -b feat/<issue>-m7-sheet-worker-db
git add supabase/migrations src
git commit -m "feat(db): Google Sheet change marks, worker functions, one wake-up"
```
PR with `Closes #<issue>` and "Also closes the #255 item: held updates no longer wake the dispatcher every minute". Labels `type:task`, `area:db`, `area:pipeline`. Run `merge-when-green.sh`, then **`hosted-push.sh`**.

---
### Task 8: The sheet worker (TypeScript) and one wake-up for both workers

**Labels:** `type:task`, `area:pipeline`, `area:api`.

**Files:**
- Create: `src/server/sheets/run-sheets.ts`, `src/server/sheets/run-sheets.test.ts`, `src/server/sheets/run-sheets.db.test.ts`, `src/server/sheets/sheets-deps.ts`, `src/server/google/token-deps.ts`, `src/server/workers/schedule-workers.ts`, `src/server/workers/schedule-workers.test.ts`, `src/server/http/internal-secret.ts`, `src/server/http/internal-secret.test.ts`
- Modify:
  - `src/server/queries/sheets.ts` (+ `createSheetStore`);
  - `src/server/queries/results.ts` (export `dbAnswerSchema`, `dbDetailRowSchema`, `toDetailRow`; `listAttendanceDetails` uses them);
  - `src/lib/sheets/requests.ts` (+ `SHEET_RULE_COUNT`);
  - `src/server/dispatch/dispatch-deps.ts` (uses `token-deps.ts`);
  - `src/app/api/internal/dispatch/route.ts` (+ test);
  - the five routes that call `scheduleDispatch()`.
- Delete: `src/server/dispatch/schedule-dispatch.ts`

**Interfaces:**
- Consumes:
  - Task 4: `planYearTabs`, `resolveTitle`, `tabContent`, `contentFingerprint`, `addSheetRequest`, `deleteSheetRequest`, `formatRequests`, `redrawRequests`, `SHEET_COLUMNS`, `sheetWords`, `sheetYear`;
  - Task 5: `GoogleSheetsClient`, `GoogleFailure`, `GoogleResult`, `SheetTabMeta`, and the config;
  - Task 7: the RPCs;
  - Task 2: `renderOwnerAlertEmail`, `refreshGoogleAccessToken`, `RefreshResult`.
- Produces:
```ts
// src/server/queries/sheets.ts
export type StoredTab = { tabKey: string; year: number; googleSheetId: number; title: string; contentHash: string; rowCount: number; formatVersion: number; startsFrom?: string | null; startsTo?: string | null };
export type SheetClaim = {
  workspaceId: string; workspaceName: string; workspaceSlug: string; timezone: string; locale: string;
  spreadsheetId: string | null; createKey: string;
  connection: { id: string; userId: string; googleSub: string; tokenEncrypted: string; scopes: string[] } | null;
  years: { year: number; version: number }[];
  tabs: StoredTab[];
};
export type SheetPausedAlert = { email: string; workspaceName: string; workspaceSlug: string; reason: SheetPauseReason };
export type SheetStore = {
  claim(run: string, limit: number, leaseSeconds: number): Promise<SheetClaim[]>;
  rows(workspaceId: string, year: number): Promise<SheetSourceRow[]>;
  saveFile(workspaceId: string, run: string, spreadsheetId: string): Promise<boolean>;
  saveTab(workspaceId: string, run: string, tab: StoredTab): Promise<boolean>;
  dropTabs(workspaceId: string, run: string, keys: string[]): Promise<void>;
  finishYear(workspaceId: string, run: string, year: number, version: number): Promise<boolean>;
  release(workspaceId: string, run: string, synced: boolean): Promise<void>;
  retry(workspaceId: string, run: string, error: string): Promise<void>;
  pause(workspaceId: string, run: string, reason: SheetPauseReason): Promise<SheetPausedAlert | null>;
};
export function createSheetStore(admin: SupabaseClient<Database>): SheetStore; // throws on a DB error (the run logs it)
// src/server/sheets/run-sheets.ts
export type SheetsDeps = {
  store: SheetStore;
  google: GoogleSheetsClient;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  openToken: (sealed: string, userId: string, googleSub: string) => string;
  alertPaused: (alert: SheetPausedAlert) => Promise<void>;
  reportBug: (context: { where: string; status: number; reason: string }) => void;
  hash: (text: string) => string;
  now: () => number;
  newRunId: () => string;
  /** A random positive 31-bit id for a new tab or Meeting filter box (Google accepts ids we choose, S6). */
  newObjectId: () => number;
};
export type SheetSyncOptions = { budgetMs: number; minLeftMs: number; batchSize: number; leaseSeconds: number; tabRowsMax: number; cellsMax: number; formatVersion: number };
export type SheetSyncSummary = { sheets: number; tabs: number; rows: number; skipped: number; paused: number; retried: number };
export function runSheetSync(deps: SheetsDeps, options: SheetSyncOptions): Promise<SheetSyncSummary>;
// src/server/workers/schedule-workers.ts
export type Worker = "emails" | "sheets";
export function scheduleWorkers(which?: ReadonlyArray<Worker>): void; // default both
// src/server/http/internal-secret.ts
export function requireInternalSecret(request: Request): NextResponse | null;
// src/server/google/token-deps.ts
export function googleTokenDeps(): { refresh: (refreshToken: string) => Promise<RefreshResult>; openToken: (sealed: string, userId: string, googleSub: string) => string };
```

- [ ] **Step 1: Shared pieces first (failing tests, then code)**

1. **`internal-secret.test.ts`:** move the three "secret" cases from `src/app/api/internal/dispatch/route.test.ts` here:
   - the right secret → `null`;
   - a wrong or missing one → 401;
   - no secret configured → 404.

   Write `requireInternalSecret` from the current route body:
   ```ts
   /** The Bearer check of internal routes (Supabase Cron only, spec §8); null when the caller may pass. */
   export function requireInternalSecret(request: Request): NextResponse | null {
     const secret = getServerEnv().DISPATCH_SECRET;
     if (!secret) {
       return apiError("not_found");
     }
     const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
     return tokensEqual(provided, secret) ? null : apiError("unauthenticated");
   }
   ```
2. **`token-deps.ts`:** cut `refresh` and `openToken` (and the key and client id/secret lookups) out of `createDispatchDeps` into `googleTokenDeps()`. `createDispatchDeps` spreads it. The existing dispatcher tests must stay green.
3. **`requests.ts`:** add
   ```ts
   /** How many colour rules `formatRequests` adds (two band rules, two per tint); a tab with fewer lost some. */
   export const SHEET_RULE_COUNT = 2 + TINTS.length * 2;
   ```
   with a test in `requests.test.ts`: `formatRequests(1, { conditionalFormats: 0, slicerIds: [] }, words, 2).filter((r) => "addConditionalFormatRule" in r)` has length `SHEET_RULE_COUNT`.
4. **`results.ts`:** extract the row schema of `listAttendanceDetails` into exported `dbDetailRowSchema` (the `z.object({...})`) and `toDetailRow(db)` (the mapping), and export `dbAnswerSchema`. `listAttendanceDetails` uses both; its tests stay green.

Run: `bun run test src/server src/lib/sheets`
Expected: PASS.

- [ ] **Step 2: Write the failing worker unit tests (fake store, fake Google)**

`src/server/sheets/run-sheets.test.ts`. Build a small in-memory fake:
- `fakeStore(claims, rowsByYear)` records calls and returns the claims once, then `[]`;
- `fakeGoogle()` keeps a `Map<sheetId, { title, values }>` from the `updateCells` requests it receives, plus queues of forced results per method.

Cover, one `it` each:
1. "creates the file once, reusing a file tagged with the same key after a crash": `findFile` → `"f1"`, so `createFile` is never called and `saveFile("f1")` is.
2. "adopts the new file's only tab for the newest year and formats it": `readTabs` returns `[{ sheetId: 0, title: "Sheet1", … }]`. The first batch has no `addSheet`, it does `formatRequests(0, …)`, and `saveTab` gets `googleSheetId: 0, title: "2026"`.
3. "skips a tab whose content and title didn't change": the stored hash equals the new one, `readTabs` has the id with 10 rules and 1 slicer, so no `batchUpdate` and `skipped` = 1.
4. "re-applies formatting that someone removed": the same, but `conditionalFormats: 3`, gives one batch with `deleteConditionalFormatRule` × 3 then the new rules.
5. "recreates a tab someone deleted, with a new id": the stored id is missing from `readTabs`, gives `addSheet` with `newObjectId()`'s value and `saveTab` with that id.
6. "names our tab "2026 (TapNShow)" when someone else's tab is called 2026".
7. "drops tabs a year no longer needs, in Google and in the store": stored keys `2026-1`, `2026-2`, but the plan has one tab `2026`.
8. "leaves a year marked when its version moved during the write": `finishYear` returns false and the run still releases with `synced: true`. Then a second run (claims again) writes the same values: compare the fake's cells after both runs, they are equal.
9. "pauses on a trashed file, on 404, on lost access, without Sheets permission, and on a full sheet, alerting once": parametrised over `fileTrashed → true`, `fileTrashed → not_found`, `refresh → invalid_grant`, `connection.scopes` without drive.file, and `cellsMax: 10`. Check `pause` with each reason, and `alertPaused` called with the store's alert.
10. "retries without pausing on 429, on a rate-limit 403, and reports a disabled API": `batchUpdate → { kind: "retry", status: 429 }` gives `store.retry`, and `pause` is never called. `{ kind: "bug", reason: "accessNotConfigured" }` gives `reportBug` + `store.retry`.
11. "refreshes once on 401, then gives up as access lost": `readTabs → unauthorized` twice, so `refresh` is called twice in total and `pause("access_lost")`.
12. "stops before a Google call when less than minLeftMs is left, leaving the year marked": `now` advances by 40 s per call with budget 50 s / minLeft 20 s, so `finishYear` is never called for the second year and `release(…, false)`.
13. "never writes a formula": every `stringValue` in every request equals the fixture text, and no request contains `formulaValue`.

Run: `bun run test src/server/sheets/run-sheets.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write `run-sheets.ts`**

```ts
import "server-only";
import { DRIVE_FILE_SCOPE } from "@/config/sheets";
import { resolveLocale } from "@/config/i18n";
import { logger } from "@/lib/logger";
import {
  addSheetRequest,
  deleteSheetRequest,
  formatRequests,
  redrawRequests,
  SHEET_COLUMNS,
  SHEET_RULE_COUNT,
} from "@/lib/sheets/requests";
import { contentFingerprint, tabContent } from "@/lib/sheets/content";
import { planYearTabs, resolveTitle } from "@/lib/sheets/tabs";
import type { PlannedTab } from "@/lib/sheets/types";
import { sheetWords } from "@/lib/sheets/words";
import { sheetYear } from "@/lib/sheets/year";
import { EXPORT_HEADER_ROWS } from "@/lib/export/theme";
import type { GoogleFailure, GoogleResult, GoogleSheetsClient, SheetTabMeta } from "@/server/google/sheets-client";
import type { RefreshResult } from "@/server/google/google-oauth";
import type { SheetClaim, SheetPausedAlert, SheetStore, StoredTab } from "@/server/queries/sheets";
import type { SheetPauseReason } from "@/emails/owner-alert-email";
import messages from "../../../messages/en.json";

// (types SheetsDeps, SheetSyncOptions, SheetSyncSummary exactly as in Interfaces)

const cellsOf = (rows: number) => (EXPORT_HEADER_ROWS + Math.max(rows, 1)) * SHEET_COLUMNS;

/** Tabs newest first: a later year first, then chunk 1 before chunk 2. */
function newer(a: { year: number; tabKey: string }, b: { year: number; tabKey: string }): boolean {
  const chunk = (key: string) => Number(key.split("-")[1] ?? 0);
  return a.year > b.year || (a.year === b.year && chunk(a.tabKey) < chunk(b.tabKey));
}

/** Where a new tab goes so ours stay newest first: before the first older TapNShow tab. */
function insertIndex(tab: { year: number; tabKey: string }, ours: StoredTab[], live: SheetTabMeta[]): number {
  const placed = ours
    .map((stored) => ({ stored, meta: live.find((meta) => meta.sheetId === stored.googleSheetId) }))
    .filter((entry): entry is { stored: StoredTab; meta: SheetTabMeta } => entry.meta !== undefined);
  const older = placed.filter((entry) => newer(tab, entry.stored)).map((entry) => entry.meta.index);
  if (older.length > 0) {
    return Math.min(...older);
  }
  const all = placed.map((entry) => entry.meta.index);
  return all.length > 0 ? Math.max(...all) + 1 : 0;
}

/**
 * Redraws every due sheet within the time budget (spec §8): access, file, then each changed year
 * newest first; a year is cleared only if nothing changed meanwhile. Never throws for one sheet:
 * a database error on one sheet is logged and the run continues with the next.
 */
export async function runSheetSync(deps: SheetsDeps, options: SheetSyncOptions): Promise<SheetSyncSummary> {
  const run = deps.newRunId();
  const started = deps.now();
  const summary: SheetSyncSummary = { sheets: 0, tabs: 0, rows: 0, skipped: 0, paused: 0, retried: 0 };
  const canCall = () => options.budgetMs - (deps.now() - started) >= options.minLeftMs;
  while (canCall()) {
    const claims = await deps.store.claim(run, options.batchSize, options.leaseSeconds);
    if (claims.length === 0) {
      break;
    }
    for (const claim of claims) {
      summary.sheets += 1;
      try {
        await syncSheet(deps, options, run, claim, canCall, summary);
      } catch (error) {
        logger.error({ err: error }, "sheet sync failed");
        await deps.store.retry(claim.workspaceId, run, "internal").catch(() => undefined);
        summary.retried += 1;
      }
    }
  }
  logger.info({ summary }, "sheet run finished");
  return summary;
}

async function syncSheet(
  deps: SheetsDeps,
  options: SheetSyncOptions,
  run: string,
  claim: SheetClaim,
  canCall: () => boolean,
  summary: SheetSyncSummary,
): Promise<void> {
  const workspace = claim.workspaceId;
  const words = sheetWords(resolveLocale(claim.locale), messages);
  const pause = async (reason: SheetPauseReason) => {
    summary.paused += 1;
    const alert = await deps.store.pause(workspace, run, reason);
    if (alert) {
      await deps.alertPaused(alert).catch((error: Error) => logger.error({ err: error }, "sheet-paused alert failed"));
    }
  };
  const fail = async (failure: GoogleFailure, where: string) => {
    if (failure.kind === "access_lost" || failure.kind === "unauthorized") {
      return pause("access_lost");
    }
    if (failure.kind === "not_found") {
      return pause("deleted");
    }
    if (failure.kind === "bug") {
      deps.reportBug({ where, status: failure.status, reason: failure.reason });
    }
    summary.retried += 1;
    return deps.store.retry(workspace, run, `${where}:${failure.kind === "bug" ? failure.reason : failure.status}`);
  };
  if (!claim.connection || !claim.connection.scopes.includes(DRIVE_FILE_SCOPE)) {
    return pause("access_lost");
  }
  const connection = claim.connection;
  const refreshToken = deps.openToken(connection.tokenEncrypted, connection.userId, connection.googleSub);
  let token: string | null = null;
  const refresh = async (): Promise<"ok" | "stop"> => {
    const refreshed = await deps.refresh(refreshToken);
    if (refreshed.kind === "ok") {
      token = refreshed.accessToken;
      return "ok";
    }
    if (refreshed.kind === "invalid_grant") {
      await pause("access_lost");
    } else {
      summary.retried += 1;
      await deps.store.retry(workspace, run, `refresh:${refreshed.status}`);
    }
    return "stop";
  };
  if ((await refresh()) === "stop") {
    return;
  }
  /** One Google call; a 401 gets one fresh token and one more try (spec §8). */
  const google = async <T>(call: (token: string) => Promise<GoogleResult<T>>): Promise<GoogleResult<T>> => {
    const first = await call(token ?? "");
    if (first.kind !== "unauthorized" || (await refresh()) === "stop") {
      return first;
    }
    return call(token ?? "");
  };

  let spreadsheetId = claim.spreadsheetId;
  let created = false;
  if (!spreadsheetId) {
    const found = await google((t) => deps.google.findFile(t, claim.createKey));
    if (found.kind !== "ok") {
      return fail(found, "find");
    }
    spreadsheetId = found.value;
    if (!spreadsheetId) {
      const made = await google((t) =>
        deps.google.createFile(t, {
          name: words.sheet("fileName", { workspace: claim.workspaceName }),
          workspaceId: workspace,
          createKey: claim.createKey,
        }),
      );
      if (made.kind !== "ok") {
        return fail(made, "create");
      }
      spreadsheetId = made.value;
    }
    created = true;
    if (!(await deps.store.saveFile(workspace, run, spreadsheetId))) {
      return;
    }
  } else {
    const trashed = await google((t) => deps.google.fileTrashed(t, spreadsheetId ?? ""));
    if (trashed.kind !== "ok") {
      return fail(trashed, "file");
    }
    if (trashed.value) {
      return pause("trashed");
    }
  }
  const file = spreadsheetId;
  const meta = await google((t) => deps.google.readTabs(t, file));
  if (meta.kind !== "ok") {
    return fail(meta, "tabs");
  }
  let live = meta.value;
  const stored = [...claim.tabs];
  const ourIds = () => new Set(stored.map((tab) => tab.googleSheetId));
  // A file made in this run has Google's default tab, which becomes the newest year's tab.
  let adoptable: SheetTabMeta | undefined =
    created && stored.length === 0 && live.length === 1 ? live[0] : undefined;
  const currentYear = sheetYear(new Date(deps.now()).toISOString(), claim.timezone);
  let complete = true;

  for (const { year, version } of claim.years) {
    if (!canCall()) {
      complete = false;
      break;
    }
    const rows = await deps.store.rows(workspace, year);
    const planned: PlannedTab[] = planYearTabs(year, rows, { maxRows: options.tabRowsMax, currentYear, words });
    const otherCells = stored.filter((tab) => tab.year !== year).reduce((sum, tab) => sum + cellsOf(tab.rowCount), 0);
    const plannedCells = planned.reduce((sum, tab) => sum + cellsOf(tab.rows.length), 0);
    if (otherCells + plannedCells > options.cellsMax) {
      return pause("full");
    }
    for (const tab of planned) {
      if (!canCall()) {
        complete = false;
        break;
      }
      const previous = stored.find((candidate) => candidate.tabKey === tab.key);
      const existing = previous ? live.find((item) => item.sheetId === previous.googleSheetId) : undefined;
      const reuse = existing ?? adoptable;
      const taken = new Set(live.filter((item) => !ourIds().has(item.sheetId) && item.sheetId !== reuse?.sheetId).map((item) => item.title));
      const title = resolveTitle(tab.title, taken, words);
      const content = tabContent(tab, { workspaceName: claim.workspaceName, updatedAt: new Date(deps.now()), timezone: claim.timezone, words });
      const hash = deps.hash(contentFingerprint(tab, content));
      const formatted =
        reuse !== undefined && reuse === existing && (previous?.formatVersion ?? 0) >= options.formatVersion &&
        reuse.conditionalFormats >= SHEET_RULE_COUNT && reuse.slicerIds.length === 1;
      if (previous && existing && formatted && previous.contentHash === hash && existing.title === title) {
        summary.skipped += 1;
        continue;
      }
      const sheetId = reuse?.sheetId ?? deps.newObjectId();
      const slicerId = formatted ? reuse.slicerIds[0] : deps.newObjectId();
      const index = insertIndex({ year, tabKey: tab.key }, stored, live);
      const requests = [
        ...(reuse ? [] : [addSheetRequest(sheetId, title, index)]),
        ...(formatted ? [] : formatRequests(sheetId, { conditionalFormats: reuse?.conditionalFormats ?? 0, slicerIds: reuse?.slicerIds ?? [] }, words, slicerId)),
        ...redrawRequests(sheetId, title, content, slicerId),
      ];
      const written = await google((t) => deps.google.batchUpdate(t, file, requests));
      if (written.kind !== "ok") {
        return fail(written, "write");
      }
      const saved: StoredTab = {
        tabKey: tab.key, year, googleSheetId: sheetId, title, contentHash: hash, rowCount: tab.rows.length,
        formatVersion: options.formatVersion, startsFrom: tab.startsFrom, startsTo: tab.startsTo,
      };
      if (!(await deps.store.saveTab(workspace, run, saved))) {
        return;
      }
      if (!reuse) {
        live = [...live.map((item) => (item.index >= index ? { ...item, index: item.index + 1 } : item)),
          { sheetId, title, index, conditionalFormats: SHEET_RULE_COUNT, slicerIds: [slicerId] }];
      }
      if (reuse === adoptable) {
        adoptable = undefined;
      }
      const at = stored.findIndex((candidate) => candidate.tabKey === tab.key);
      if (at >= 0) {
        stored[at] = saved;
      } else {
        stored.push(saved);
      }
      summary.tabs += 1;
      summary.rows += tab.rows.length;
    }
    if (!complete) {
      break;
    }
    const keep = new Set(planned.map((tab) => tab.key));
    const leftovers = stored.filter((tab) => tab.year === year && !keep.has(tab.tabKey));
    if (leftovers.length > 0) {
      const present = leftovers.filter((tab) => live.some((item) => item.sheetId === tab.googleSheetId));
      if (present.length > 0) {
        const dropped = await google((t) => deps.google.batchUpdate(t, file, present.map((tab) => deleteSheetRequest(tab.googleSheetId))));
        if (dropped.kind !== "ok") {
          return fail(dropped, "drop");
        }
      }
      await deps.store.dropTabs(workspace, run, leftovers.map((tab) => tab.tabKey));
    }
    await deps.store.finishYear(workspace, run, year, version);
  }
  await deps.store.release(workspace, run, complete);
}
```

Notes for the implementer:
- `slicerIds: [0]` for a tab added in this run is a placeholder count: the next run reads real ids. Keep it, and name it in a comment.
- If the deleted-tab case leaves `existing` undefined while `previous` exists, `reuse` is undefined, so `addSheet` runs with a new id, and `saveTab` overwrites the stored id. That is test 5.
- `messages` import: the worker always uses the bundled catalogue (only `en` exists). When `fr`/`ar` arrive, `resolveLocale` picks the catalogue, so add a `catalogueFor(locale)` then.

Run: `bun run test src/server/sheets/run-sheets.test.ts`
Expected: PASS.

- [ ] **Step 4: The store, with an integration test against the local DB and a fake Google**

Add `createSheetStore(admin)` to `src/server/queries/sheets.ts`:
- each method is one `admin.rpc(...)` (Task 7 names);
- the claim is parsed with Zod into `SheetClaim`;
- rows use `dbDetailRowSchema.extend({ meeting_status: z.enum(["scheduled", "cancelled"]), lists: z.array(z.string()) })` mapped with `toDetailRow` plus `meetingStatus` and `lists`;
- the pause alert is parsed into `SheetPausedAlert`;
- any `error` throws `new Error(\`${name} failed: ${error.code ?? ""}\`)`, never the message text (it can hold data).

`src/server/sheets/run-sheets.db.test.ts`:
- seed a workspace with a sheet (Task 6 helpers), a 2026 meeting with three invitees, one answer and one check-in, then `makeDue`;
- run `runSheetSync` with the real store, the Task 5 client pointed at a tiny in-process fake (`http.createServer` on a free port answering `findFile` / `createFile` / `fileTrashed` / `readTabs` / `batchUpdate` and recording the requests), `refresh` returning `{ kind: "ok", accessToken: "t" }`, `openToken` = identity, and `hash` = sha256.

Expected:
- the fake received one `files.create` and one `batchUpdate` whose `updateCells` rows hold the three names in name order;
- `sheet_tabs` has `2026`;
- `sheet_dirty_years` is empty;
- `sheet_syncs.synced_at` is set.

Then answer again, `makeDue`, run again: one more `batchUpdate`, and the cell of that person changed.

- [ ] **Step 5: `sheets-deps.ts`, `scheduleWorkers`, the route**

```ts
// sheets-deps.ts
import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { SHEET_REQUEST_TIMEOUT_MS } from "@/config/sheets";
import { renderOwnerAlertEmail } from "@/emails/owner-alert-email";
import { createSystemMailer } from "@/server/email/system-mailer";
import { googleTokenDeps } from "@/server/google/token-deps";
import { createGoogleSheetsClient } from "@/server/google/sheets-client";
import { createSheetStore } from "@/server/queries/sheets";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { SheetsDeps } from "./run-sheets";

/**
 * Real dependencies for `runSheetSync`.
 * @throws Error naming the first missing secret
 */
export function createSheetsDeps(): SheetsDeps {
  const env = getServerEnv();
  const mailer = createSystemMailer();
  const appUrl = publicEnv.NEXT_PUBLIC_APP_URL;
  return {
    store: createSheetStore(createSupabaseAdminClient()),
    google: createGoogleSheetsClient({
      sheetsBaseUrl: env.GOOGLE_SHEETS_API_BASE_URL,
      driveBaseUrl: env.GOOGLE_DRIVE_API_BASE_URL,
      timeoutMs: SHEET_REQUEST_TIMEOUT_MS,
    }),
    ...googleTokenDeps(),
    alertPaused: async (alert) => {
      const content = await renderOwnerAlertEmail({
        kind: "sheetPaused",
        reason: alert.reason,
        workspaceName: alert.workspaceName,
        settingsUrl: `${appUrl}/w/${alert.workspaceSlug}/settings#sheets`,
      });
      await mailer.send({ to: alert.email, ...content });
    },
    reportBug: (context) => Sentry.captureMessage(`Google Sheets ${context.where} ${context.status} ${context.reason}`, "error"),
    hash: (text) => createHash("sha256").update(text).digest("hex"),
    now: () => Date.now(),
    newRunId: () => randomUUID(),
    // Sheets tab ids are positive 31-bit integers; Google keeps 0 for the first tab.
    newObjectId: () => randomInt(1, 2 ** 31 - 1),
  };
}
```

`src/server/workers/schedule-workers.ts`:
```ts
import "server-only";
import { after } from "next/server";
import * as config from "@/config/meetings";
import * as sheets from "@/config/sheets";
import { logger } from "@/lib/logger";
import { createDispatchDeps } from "@/server/dispatch/dispatch-deps";
import { runDispatch } from "@/server/dispatch/run-dispatch";
import { createSheetsDeps } from "@/server/sheets/sheets-deps";
import { runSheetSync } from "@/server/sheets/run-sheets";

/** A background worker the internal route can start. */
export type Worker = "emails" | "sheets";

/** The production run options of each worker. */
export const WORKER_OPTIONS = {
  emails: {
    budgetMs: config.DISPATCH_BUDGET_MS,
    paceMs: config.DISPATCH_PACE_MS,
    batchSize: config.DISPATCH_BATCH_SIZE,
    leaseSeconds: config.DISPATCH_LEASE_SECONDS,
  },
  sheets: {
    budgetMs: sheets.SHEET_BUDGET_MS,
    minLeftMs: sheets.SHEET_MIN_LEFT_MS,
    batchSize: sheets.SHEET_CLAIM_BATCH,
    leaseSeconds: sheets.SHEET_LEASE_SECONDS,
    tabRowsMax: sheets.SHEET_TAB_ROWS_MAX,
    cellsMax: sheets.SHEET_CELLS_MAX,
    formatVersion: sheets.SHEET_FORMAT_VERSION,
  },
} as const;

/**
 * Starts the named workers after the response is sent (Next `after()`), side by side, each with its
 * own budget; one failing never stops the other. Failures are logged, never thrown into the request.
 */
export function scheduleWorkers(which: ReadonlyArray<Worker> = ["emails", "sheets"]): void {
  after(async () => {
    const runs = which.map((worker) =>
      worker === "emails"
        ? runDispatch(createDispatchDeps(), WORKER_OPTIONS.emails)
        : runSheetSync(createSheetsDeps(), WORKER_OPTIONS.sheets),
    );
    for (const result of await Promise.allSettled(runs)) {
      if (result.status === "rejected") {
        logger.error({ err: result.reason }, "worker run failed");
      }
    }
  });
}
```

Use the real constant names from `src/config/meetings.ts`; the namespace import keeps this file short. Import the four named constants if lint prefers that.

`schedule-workers.test.ts`: mock `next/server` (`after: (fn) => fn()`), both runners and both deps factories. Check that:
- the default runs both;
- `["emails"]` runs only the dispatcher;
- a rejected sheet run still lets the dispatcher finish and logs once.

Routes:
- `src/app/api/internal/dispatch/route.ts` becomes `requireInternalSecret` + `scheduleWorkers()` (both);
- the five other routes call `scheduleWorkers(["emails"])` (their old behaviour);
- delete `schedule-dispatch.ts`; update the route tests' mocks (`@/server/workers/schedule-workers`);
- the internal route's JSDoc says "Called every minute by Supabase Cron when emails or a Google Sheet are due".

Then run `grep -rn "schedule-dispatch\|scheduleDispatch" src`. Expected: no output.

- [ ] **Step 6: Full check, commit, PR**

```bash
bunx prettier --write src && bun run format:check && bun run lint && bun run typecheck && bun run test \
  && supabase db reset --local </dev/null && bun run test:db
```
Expected: all pass.

```bash
git checkout -b feat/<issue>-m7-sheet-worker
git add src
git commit -m "feat: Google Sheet worker and one wake-up for both workers"
```
PR with `Closes #<issue>`, labels `type:task`, `area:pipeline`, `area:api`. Then `merge-when-green.sh`. No migration, so no hosted push.

---
### Task 9: Connect flow: purposes, replace, resume, one result banner

**Labels:** `type:task`, `area:auth`, `area:api`, `area:frontend`.

**Files:**
- Create: `src/shared/api/google-connect.ts`, `src/app/w/[slug]/settings/google-connect-result.tsx` (+ test)
- Modify:
  - `src/server/google/google-oauth.ts` (+ test): purpose and replace in the URL and the cookie;
  - `src/config/gmail.ts`: the cookie names stay; JSDoc says "Google connection";
  - `src/lib/with-query.ts`: `settingsPath(slug, section)` replaces `senderSettingsPath`;
  - `src/app/api/integrations/google/connect/route.ts` (+ test) and `callback/route.ts` (+ test);
  - `src/app/w/[slug]/settings/sending-section.tsx` and `src/app/w/[slug]/meetings/[id]/edit/review-step.tsx`: use `GoogleConnectResult purpose="sending"`;
  - `src/hooks/use-sender.ts`: `gmailConnectHref` builds through the shared `googleConnectHref`;
  - `messages/en.json`.
- Delete: `src/app/w/[slug]/settings/gmail-connect-result.tsx` (+ test); `GMAIL_CONNECT_ERRORS` / `GmailConnectError` from `src/shared/api/sender.ts`.

**Interfaces:**
- Produces:
```ts
// src/shared/api/google-connect.ts
export const GOOGLE_CONNECT_PURPOSES = ["sending", "sheets"] as const;
export type GoogleConnectPurpose = (typeof GOOGLE_CONNECT_PURPOSES)[number];
export const GOOGLE_CONNECT_ERRORS = ["unavailable", "owner_only", "cancelled", "scope_denied", "no_refresh_token", "failed", "rate_limited", "sheet_wrong_account"] as const;
export type GoogleConnectError = (typeof GOOGLE_CONNECT_ERRORS)[number];
/** Query parameters the callback adds on return. */
export const GOOGLE_RESULT_PARAMS = { done: "google", error: "google_error", purpose: "google_for" } as const;
export function googleConnectHref(slug: string, purpose: GoogleConnectPurpose, options?: { next?: string; replace?: boolean }): string;
// google-oauth.ts
export type GoogleConnectState = { state: string; verifier: string; workspaceSlug: string; next: string | null; purpose: GoogleConnectPurpose; replace: boolean };
export function createGoogleConnectAuthorization(input: { clientId: string; redirectUri: string; workspaceSlug: string; next: string | null; purpose: GoogleConnectPurpose; replace: boolean }): { url: string; state: GoogleConnectState };
// with-query.ts
export function settingsPath(slug: string, section: "sending" | "sheets"): string;
// google-connect-result.tsx
export function GoogleConnectResult({ purpose }: { purpose: GoogleConnectPurpose }): JSX.Element | null;
```

- [ ] **Step 1: The URL and cookie carry the purpose (failing test first)**

Add to `google-oauth.test.ts`:
```ts
it("asks for Gmail sending or for the Sheets file permission, keeping earlier grants", () => {
  const sending = createGoogleConnectAuthorization({ clientId: "c", redirectUri: "r", workspaceSlug: "w", next: null, purpose: "sending", replace: false });
  const sheets = createGoogleConnectAuthorization({ clientId: "c", redirectUri: "r", workspaceSlug: "w", next: null, purpose: "sheets", replace: true });
  expect(new URL(sending.url).searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/gmail.send");
  expect(new URL(sheets.url).searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/drive.file");
  expect(new URL(sheets.url).searchParams.get("include_granted_scopes")).toBe("true");
  expect(decodeConnectCookie(encodeConnectCookie(sheets.state))).toMatchObject({ purpose: "sheets", replace: true });
});

it("reads an old cookie without a purpose as Gmail sending", () => {
  const old = Buffer.from(JSON.stringify({ state: "s", verifier: "v", workspaceSlug: "w", next: null })).toString("base64url");
  expect(decodeConnectCookie(old)).toMatchObject({ purpose: "sending", replace: false });
});
```
Run it. Expected: FAIL.

Then implement:
- in `connectStateSchema`, add `purpose: z.enum(GOOGLE_CONNECT_PURPOSES).default("sending")` and `replace: z.boolean().default(false)`;
- the scope is `(input.purpose === "sheets" ? SHEETS_CONNECT_SCOPES : GMAIL_CONNECT_SCOPES).join(" ")`;
- update the JSDoc.

Run it again. Expected: PASS.

- [ ] **Step 2: `settingsPath`, `googleConnectHref` (failing tests first)**

`with-query.test.ts`:
- `settingsPath("club-ab12", "sheets")` → `/w/club-ab12/settings#sheets`;
- a bad slug → `/welcome`, the same rule as before;
- replace every `senderSettingsPath(x)` call with `settingsPath(x, "sending")`.

`src/shared/api/google-connect.test.ts`:
- `googleConnectHref("club-ab12", "sheets", { replace: true })` → `/api/integrations/google/connect?workspace=club-ab12&purpose=sheets&replace=1`;
- `googleConnectHref("club-ab12", "sending")` → `/api/integrations/google/connect?workspace=club-ab12&purpose=sending`.

`gmailConnectHref(slug, next)` in `use-sender.ts` becomes `googleConnectHref(slug, "sending", { next })` at its call sites. Delete `gmailConnectHref` once `grep` finds no caller.

- [ ] **Step 3: The connect route (failing route tests first)**

New cases in `connect/route.test.ts`:
- `purpose=sheets&replace=1` → the cookie has `purpose: "sheets", replace: true`, and the redirect scope has `drive.file`;
- an unknown `purpose` → treated as `sending`;
- more than `google_connects_per_user_per_hour` starts → back with `google_error=rate_limited&google_for=sheets` (mock `hitGoogleConnectLimit` → `{ data: false }`);
- a non-owner → `google_error=owner_only`.

Route changes:
- `purpose` = `GOOGLE_CONNECT_PURPOSES.find((p) => p === params.get("purpose")) ?? "sending"`;
- `replace` = `params.get("replace") === "1"`;
- `returnTo` defaults to `settingsPath(slug, purpose)`;
- `back(reason)` adds `google_error` and `google_for`;
- after the owner check, `const limit = await hitGoogleConnectLimit(supabase); if (limit.error || !limit.data) return back("rate_limited");`.

- [ ] **Step 4: The callback (failing route tests first)**

Extend `callback/route.test.ts` (keep every existing case, renamed to the new params). The mocks also cover `startSheet`, `googleConnectionSaved` (`@/server/queries/sheets`), `revokeReleased` (`@/server/google/release`) and `scheduleWorkers` (`@/server/workers/schedule-workers`). New cases:
1. "sheets: saves the connection, starts the sheet, kicks the sheet worker, returns to Sheets":
   - grant scopes `["openid", DRIVE_FILE]`;
   - `startSheet` is called with `{ userId: "user-1", workspaceId: "w1", connectionId: "conn-1", replace: false }`;
   - `googleConnectionSaved` is called;
   - `scheduleWorkers` is called with `["sheets"]`;
   - the redirect is `/w/club-ab12/settings?google=connected&google_for=sheets#sheets`.
2. "sheets: an unticked Sheets box saves a Gmail grant but starts nothing": scopes `["openid", GMAIL_SEND]`, so `save` is called, `startSheet` is not, nothing is revoked, and the redirect has `google_error=scope_denied&google_for=sheets`.
3. "sheets: neither permission → revoked, nothing saved": scopes `["openid", "email"]`.
4. "sheets: another account than the sheet's → plain message": `startSheet` errors `tn:sheet_wrong_account`, so the redirect has `google_error=sheet_wrong_account`.
5. "sheets with replace: revokes the released old account": `startSheet` returns `{ started: true, released: {…} }`, so `revokeReleased` is called with `[released]`.
6. "sending: a Sheets-only grant isn't revoked when Gmail is unticked": scopes `["openid", DRIVE_FILE]` with purpose sending, so `save` is called, `setSender` is not, and the error is `scope_denied`.
7. "every success re-checks the account's sheets": `googleConnectionSaved` is called after `save` for both purposes.

Callback body, after the existing state, user and owner checks:
```ts
const purposeScope = stored.purpose === "sheets" ? DRIVE_FILE_SCOPE : GMAIL_SEND_SCOPE;
const usable = grant.scopes.includes(GMAIL_SEND_SCOPE) || grant.scopes.includes(DRIVE_FILE_SCOPE);
if (!usable) {
  if (grant.refreshToken) {
    await revokeGoogleToken(grant.refreshToken);
  }
  return fail("scope_denied");
}
if (!grant.refreshToken) {
  return fail("no_refresh_token");
}
if (!grant.claims.emailVerified) {
  await revokeGoogleToken(grant.refreshToken);
  return fail("failed");
}
// saveGoogleConnection exactly as before (sealed token, service role)
const admin = createSupabaseAdminClient();
const saved = await saveGoogleConnection(admin, { … });
if (saved.error || !saved.data) { … return fail("failed"); }
await googleConnectionSaved(admin, { userId: user.id, connectionId: saved.data });
if (!grant.scopes.includes(purposeScope)) {
  return fail("scope_denied");
}
if (stored.purpose === "sending") {
  const sender = await setWorkspaceSender(supabase, workspace.id, saved.data);
  if (sender.error) { …; return fail("failed"); }
} else {
  const started = await startSheet(admin, { userId: user.id, workspaceId: workspace.id, connectionId: saved.data, replace: stored.replace });
  if (started.error) {
    return fail(started.error.message === "tn:sheet_wrong_account" ? "sheet_wrong_account" : "failed");
  }
  await revokeReleased([started.data?.released ?? null]);
  scheduleWorkers(["sheets"]);
}
return redirectClearingCookie(withQuery(withQuery(returnTo, "google", "connected"), "google_for", stored.purpose), request);
```

`fail(reason)` = `withQuery(withQuery(returnTo, "google_error", reason), "google_for", stored.purpose)`. Make one helper `resultPath(returnTo, purpose, key, value)` in `with-query.ts` so the connect route and the callback share it.

Run: `bun run test "src/app/api/integrations"`
Expected: PASS.

- [ ] **Step 5: One result banner for both purposes (failing component test first)**

Add the messages to `messages/en.json`:
- `Settings.sending.error.rate_limited`: "Too many tries. Wait a few minutes, then connect again."
- `Settings.sending.error.sheet_wrong_account`: copy of the sheets one. It's never shown for sending, but the type requires every key.
- `Settings.sheets.connected`: "Google Sheet connected. It fills in within a minute."
- `Settings.sheets.error`:

```json
"error": {
  "unavailable": "Connecting Google isn't available right now.",
  "owner_only": "Only the workspace Owner can connect Google Sheets.",
  "cancelled": "Connecting was cancelled. Nothing changed.",
  "scope_denied": "Google didn't give permission to create the sheet. Try again and keep \"See, edit, create and delete only the specific Google Drive files you use with this app\" ticked.",
  "no_refresh_token": "Google didn't return lasting access. Try again; if it keeps happening, remove TapNShow at myaccount.google.com/permissions first.",
  "failed": "Connecting Google failed. Try again.",
  "rate_limited": "Too many tries. Wait a few minutes, then connect again.",
  "sheet_wrong_account": "This sheet is in another Google account's Drive. Pick that account, or create a new sheet."
}
```

Use Google's exact checkbox wording from S6 (docs/spikes/S6.md) if it differs.

`google-connect-result.test.tsx`, with three cases:
- `?google=connected&google_for=sheets` shows the sheets toast in `purpose="sheets"`, and nothing in `purpose="sending"`;
- `?google_error=sheet_wrong_account&google_for=sheets` shows the plain alert;
- the params are removed from the URL after reading, the hash is kept, and `router.replace` gets the path without them.

`google-connect-result.tsx`: `GmailConnectResult`'s body, with:
- `useTranslations(purpose === "sheets" ? "Settings.sheets" : "Settings.sending")`;
- read and remove `google`, `google_error` and `google_for`;
- act only when `google_for === purpose`.

Use one `t` typed by a mapped union. If next-intl's typing fights the conditional namespace, render one of two small inner components that each call `useTranslations` with a literal namespace.

Replace both uses. `SendingSection`'s `returning` becomes `params.get("google_for") === "sending"`. Delete the old files and `GMAIL_CONNECT_ERRORS`.

Run `grep -rn "gmail_error\|GmailConnectResult\|GMAIL_CONNECT_ERRORS\|senderSettingsPath" src`. Expected: no output.

- [ ] **Step 6: Full check, commit, PR**

Run the chained check (unit + typecheck + lint).

```bash
git checkout -b feat/<issue>-m7-connect-sheets
git add src messages
git commit -m "feat: connect Google Sheets (purpose, replace, resume) and one result banner"
```
PR with `Closes #<issue>`, labels `type:task`, `area:auth`, `area:api`, `area:frontend`. Then `merge-when-green.sh`.

**This PR makes the first `sheet_syncs` rows possible on production. Task 8 must already be merged** (check `gh pr view <task-8-pr> --json state`).

---

### Task 10: Sheet API routes, shared schemas, hooks

**Labels:** `type:task`, `area:api`, `area:frontend`.

**Files:**
- Create: `src/shared/api/sheets.ts` (+ test), `src/app/api/workspaces/[slug]/sheet/route.ts` (+ test), `src/app/api/workspaces/[slug]/sheet/retry/route.ts` (+ test), `src/hooks/use-sheet.ts` (+ test)
- Modify: `src/server/queries/sheets.ts` (status parsing moves to the shared schema)

**Interfaces:**
- Produces:
```ts
// src/shared/api/sheets.ts
export const sheetPauseReasonSchema: z.ZodEnum<["trashed", "deleted", "access_lost", "full"]>;
export const sheetStatusSchema: z.ZodObject<{
  state: "off" | "creating" | "on" | "paused";
  spreadsheetId: string | null;
  pausedReason: SheetPauseReason | null;
  syncedAt: string | null;
  behind: boolean;
  createdAt: string | null;
  turnedOnBy: string;
  accountEmail: string | null; // Owner only
  ownerName: string;
  tabs: { year: number; googleSheetId: number; startsFrom: string | null; startsTo: string | null }[];
}>;
export type SheetStatus = z.infer<typeof sheetStatusSchema>;
// src/hooks/use-sheet.ts
export const sheetQueryKey: (slug: string) => readonly ["sheet", string];
export function useWorkspaceSheet(slug: string, options?: { following?: boolean }): UseQueryResult<SheetStatus>; // polls while "creating", or while behind after Try again (`following`)
export function useTurnOffSheet(slug: string): UseMutationResult<void, Error, void>;
export function useRetrySheet(slug: string): UseMutationResult<void, Error, void>;
export function useSheetLink(slug: string, meeting?: { startsAt: string | null; timezone: string }): { href: string | null; paused: boolean } | null; // null when no sheet
```
- Routes:
  - `GET /api/workspaces/[slug]/sheet`: any member, returns `SheetStatus`.
  - `DELETE /api/workspaces/[slug]/sheet`: Owner. Turn off: revoke what's released, return `{ ok: true }`.
  - `POST /api/workspaces/[slug]/sheet/retry`: Owner, rate limited. Calls `scheduleWorkers(["sheets"])` and returns `{ ok: true }`.

- [ ] **Step 1: Write the failing schema and route tests**

`src/shared/api/sheets.test.ts`: parses the four states. A `creating` status has `spreadsheetId: null`, a `paused` one has a `pausedReason`, and an unknown state is rejected.

`sheet/route.test.ts`, mocking `loadWorkspaceContext`, the queries and `revokeReleased`:
- GET returns the parsed status;
- DELETE without an Origin from our site → 403 `invalid_origin`;
- DELETE as the Owner calls `turnOffSheet`, then `revokeReleased([released])`, and answers `{ ok: true }`;
- DELETE as a Viewer → the DB error `tn:owner_only` → 403 `owner_only`.

`sheet/retry/route.test.ts`:
- the Owner → `retrySheet` + `scheduleWorkers(["sheets"])`;
- `tn:rate_limited` → 429;
- `tn:invalid_input` (paused for another reason) → 400.

Run them. Expected: FAIL (modules missing).

- [ ] **Step 2: Write the schema, queries and routes**

Routes follow `src/app/api/workspaces/[slug]/sender/route.ts` exactly: `rejectCrossOrigin`, then `loadWorkspaceContext`, then the query, then `fromDatabaseError` or `NextResponse.json` / `ok()`. Their JSDoc names spec §7.17. `getWorkspaceSheet` parses the jsonb (snake_case) into `SheetStatus` with a `.transform`, like `dbSenderSchema`.

Run them. Expected: PASS.

- [ ] **Step 3: The hooks (failing hook test first)**

`use-sheet.test.tsx` (`renderHook` + `routeFetch`, like `use-results.test.tsx`):
- "polls every 3 s while the sheet is being created and stops once it is on": use fake timers and two fetch replies.
- "Turn off and Try again invalidate the sheet status".
- "useSheetLink opens the meeting's year tab, says paused, or is null without a sheet".

`use-sheet.ts`:
```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SHEET_STATUS_POLL_MS } from "@/config/sheets";
import { apiRequest } from "@/lib/api-client";
import { sheetUrl, tabForMeeting } from "@/lib/sheets/url";
import { okSchema } from "@/shared/api/common";
import { type SheetStatus, sheetStatusSchema } from "@/shared/api/sheets";

/** Query key of a workspace's Google Sheet status. */
export const sheetQueryKey = (slug: string) => ["sheet", slug] as const;
const path = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}/sheet`;

/**
 * The workspace's Google Sheet (spec §7.17). Polls only while it matters: while the file is being
 * created, and after Try again until it is up to date.
 */
export function useWorkspaceSheet(slug: string, options: { following?: boolean } = {}) {
  return useQuery({
    queryKey: sheetQueryKey(slug),
    queryFn: () => apiRequest(path(slug), { schema: sheetStatusSchema }),
    refetchInterval: (query) => {
      const data = query.state.data;
      const live = data?.state === "creating" || (options.following === true && data?.behind === true);
      return live ? SHEET_STATUS_POLL_MS : false;
    },
  });
}
```
- `useTurnOffSheet` / `useRetrySheet`: `useMutation` → `apiRequest` with `DELETE` / `POST …/retry`, then `onSettled: invalidateQueries({ queryKey: sheetQueryKey(slug) })`.
- `SheetsSection` keeps a `following` state, set true by a successful Try again, and passes it to `useWorkspaceSheet`.
- `useSheetLink` reads the same query (no poll) and returns:
  - `null` when `state === "off"` or there's no data;
  - `{ href: null, paused: true }` when paused;
  - otherwise `{ href: sheetUrl(id, tabForMeeting(tabs, meeting?.startsAt ?? null, meeting?.timezone ?? "UTC")), paused: false }`.
  - Map `tabs` to the url helper's shape: `{ googleSheetId, year, startsFrom, startsTo }`.

Run: `bun run test src/hooks/use-sheet.test.tsx src/shared/api/sheets.test.ts "src/app/api/workspaces/\[slug\]/sheet"`
Expected: PASS.

- [ ] **Step 4: Full check, commit, PR**

Run the chained check.

```bash
git checkout -b feat/<issue>-m7-sheet-api
git add src
git commit -m "feat: Google Sheet status, Turn off and Try again (API and hooks)"
```
PR with `Closes #<issue>`, labels `type:task`, `area:api`, `area:frontend`. Then `merge-when-green.sh`.

---

### Task 11: UI: Settings > Sheets, Sending Disconnect, Home, Export menus

**Labels:** `type:task`, `area:frontend`, `area:i18n`.

**Files:**
- Create: `src/app/w/[slug]/settings/sheets-section.tsx` (+ test), `.superpowers/scripts/screens/m7-sheets.spec.ts`
- Modify:
  - `src/app/w/[slug]/settings/page.tsx`;
  - `sending-section.tsx` (+ test): Disconnect copy;
  - `src/app/w/[slug]/home-checklist.tsx` (+ test);
  - `src/app/w/[slug]/needs-attention.tsx` (+ test);
  - `src/components/forms/export-menu.tsx` (+ test);
  - `src/app/w/[slug]/meetings/[id]/page.tsx`, `src/app/w/[slug]/lists/attendance-view.tsx`;
  - `messages/en.json`.

**Interfaces:**
- Consumes (Task 10): `useWorkspaceSheet`, `useTurnOffSheet`, `useRetrySheet`, `useSheetLink`; (Task 9) `googleConnectHref`, `GoogleConnectResult`; `ConfirmDialog`, `SettingsSection`, `Sticker`, `Button`, `Skeleton`.
- Produces:
  - `ExportMenu` gains an optional `sheet?: { href: string | null; paused: boolean; settingsHref?: string }`.
  - `SheetsSection({ workspace, defaultOpen })`.

- [ ] **Step 1: The copy**

`messages/en.json` `Settings.sheets`, keeping the existing `connected` and `error` keys from Task 9. The wording follows the approved mockup (2026-10-10):
```json
"title": "Google Sheets",
"offBody": "Keep a live copy of every answer in a Google Sheet, one tab per year. Share it with your committee from Google Sheets.",
"connect": "Connect Google Sheets",
"tipGroup": "Tip: use your group's own Google account (for example the club's), so the sheet stays with the group.",
"connectTitle": "Create a Google Sheet for {workspace}?",
"connectBody": "It will hold the name, email, answers, reasons and comments of everyone you invite. Anyone you share it with can see all of it.",
"connectNote": "Google will ask which account to use. The sheet is saved in that account's Drive.",
"continue": "Continue to Google",
"creating": "Creating your Google Sheet…",
"fileName": "{workspace} · TapNShow",
"where": "In {account}'s Drive · turned on by {name} on {date}",
"upToDate": "Up to date",
"updating": "Updating…",
"updatedAgo": "Updated {when}",
"neverUpdated": "Not filled in yet",
"open": "Open the Google Sheet",
"copy": "Copy link",
"copied": "Link copied",
"shareTip": "To share it, open it and use Share in Google Sheets. Changes made in the sheet are replaced by TapNShow.",
"turnOff": "Turn off the Google Sheet",
"turnOffTitle": "Turn off the Google Sheet?",
"turnOffBody": "The sheet stops updating. It stays in {account}'s Drive.",
"turnedOff": "Google Sheet turned off",
"paused": "Paused",
"pausedLine": {
  "trashed": "The Google Sheet was moved to the trash. Restore it from Google Drive, then tap Try again. Or create a new one.",
  "deleted": "The Google Sheet was deleted.",
  "access_lost": "TapNShow can no longer update the Google Sheet.",
  "full": "The Google Sheet is full."
},
"tryAgain": "Try again",
"reconnect": "Reconnect Google",
"recreate": "Create a new sheet",
"recreateTitle": "Create a new Google Sheet?",
"recreateBody": "The old sheet stops updating. People you shared it with keep the old one.",
"viewerOn": "Answers are copied to a Google Sheet. Updated {when}.",
"viewerOff": "{owner}, the Owner, can turn on a Google Sheet copy of the answers.",
"viewerAccess": "If Google says you need access, ask {owner}, the Owner, to share it with you.",
"viewerPaused": "The Google Sheet is paused."
```
Also add:
- `Export.openSheet`: "Open the Google Sheet"; `Export.sheetPaused`: "The Google Sheet is paused";
- `WorkspaceHome.connectSheetsAction`: "Connect"; `WorkspaceHome.attentionSheet`: "The Google Sheet stopped updating.";
- `Settings.sending.disconnectSheets`: "The Google Sheet of {workspaces} keeps updating."

`updatedAgo`'s `{when}` comes from the app's existing relative-time helper. Find it with `grep -rn "formatDistance\|relativeTime" src/lib`, and add one in `src/lib/meetings/format.ts` with a test only if none exists.

- [ ] **Step 2: Write the failing `SheetsSection` tests**

`sheets-section.test.tsx` (`renderWithProviders`, `routeFetch`, mock `next/navigation` as in `sending-section.test.tsx`), one `it` per state:
1. Owner, off: shows the body, the tip and **Connect Google Sheets**. Clicking it opens the confirm dialog with the privacy text. **Continue to Google** sets `window.location.href` to `googleConnectHref(slug, "sheets")`; spy on a `navigate` prop or stub `window.location` the way `sending-section.test.tsx` does.
2. Creating: "Creating your Google Sheet…", and the query is refetched every 3 s.
3. On: name, account line, "Up to date" / "Updating…", **Open the Google Sheet** (an `<a>` with `href` = `sheetUrl(id)` and `target="_blank" rel="noopener noreferrer"`), **Copy link** (clipboard mocked, toast "Link copied"), **Turn off** → confirm naming the account → `DELETE` → toast.
4. Paused trashed: the line, **Try again** (`POST …/retry`, then the status is followed), **Create a new sheet** → confirm → `googleConnectHref(slug, "sheets", { replace: true })`, and **Turn off**.
5. Paused access_lost: the line and **Reconnect Google** → `googleConnectHref(slug, "sheets")` (no confirm: it changes nothing until Google returns).
6. Viewer, on: the viewer line, **Open the Google Sheet**, and the access hint naming the Owner. No Turn off, no account email.
7. Viewer, off: "{owner}, the Owner, can turn on…". Viewer, paused: "The Google Sheet is paused." Neither shows a link.

Run: `bun run test "settings/sheets-section"`
Expected: FAIL (module missing).

- [ ] **Step 3: Write `SheetsSection`**

Structure it like `SendingSection`:
- a `Sticker` with Phosphor `Table` (`primary` when off, `success` when on, `warning` when paused or creating), all `weight="bold"`;
- `SettingsSection id="sheets"`, `forceOpen` when `?google_for=sheets`;
- `<GoogleConnectResult purpose="sheets" />` at the top;
- a `Pending` union for the three dialogs: `"connect" | "recreate" | "turnOff" | null`;
- buttons stacked full width on phones, at least 44 px, primary for the main action, danger for Turn off.

The Copy link button uses `navigator.clipboard.writeText` inside a try/catch, with toast `copied`, or `Common.copyFailed` if that exists, else a new `Settings.sheets.copyFailed` "Couldn't copy the link."

Every user-facing string comes from `Settings.sheets`. No technical words.

Add to `settings/page.tsx`, right after Sending, inside `Suspense` (it reads search params):
```tsx
<Suspense fallback={<Skeleton className="h-40 w-full" />}>
  <SheetsSection workspace={workspace.data} defaultOpen={false} />
</Suspense>
```

Run: `bun run test "settings/sheets-section"`
Expected: PASS.

- [ ] **Step 4: Sending's Disconnect, Home and Needs attention (failing tests first)**

1. **`sending-section.test.tsx`:** "the Disconnect dialog says which Google Sheets keep updating". The fixture's `myConnections[0].sheets` is `["Robotics Club"]`, so the dialog text includes "The Google Sheet of Robotics Club keeps updating." In the dialog, `description` becomes the body plus, when `mine.sheets.length > 0`, a second sentence `t("disconnectSheets", { workspaces: mine.sheets.join(", ") })`.
2. **`home-checklist.test.tsx`:** the Sheets item:
   - shows **Connect** for the Owner when the sheet is off (a link to `googleConnectHref(slug, "sheets")` through the same confirm, or simpler: link to `/w/[slug]/settings#sheets`, where the confirm lives; **choose the link to Settings** so the privacy text is always seen first);
   - shows **Done** when the state is not off;
   - shows "{owner} connects Google Sheets" to an Admin;
   - "Coming soon" is gone, and so is the `soon` key once nothing uses it (`grep -rn "\"soon\"\|t(\"soon\")" src messages`).
3. **`needs-attention.test.tsx`:** for the Owner, a paused sheet shows "The Google Sheet stopped updating." with a link to `/w/[slug]/settings#sheets`, below the Gmail line when both apply. Admins and Viewers see nothing about the sheet here.

Run the three files. Expected: FAIL. Implement, then run them again. Expected: PASS.

- [ ] **Step 5: The Export menus (failing test first)**

`export-menu.test.tsx`:
- with `sheet={{ href: "https://docs.google.com/spreadsheets/d/x/edit#gid=12", paused: false }}`, a separator and an item "Open the Google Sheet" appear; it is a link, `target="_blank"`;
- with `paused: true` and a `settingsHref`, the item reads "The Google Sheet is paused" and links to Settings;
- without `sheet`, the menu is unchanged.

`ExportMenu`:
```tsx
{sheet ? (
  <>
    <DropdownMenuSeparator />
    <DropdownMenuItem asChild>
      {sheet.paused ? (
        sheet.settingsHref ? <Link href={sheet.settingsHref}>{t("sheetPaused")}</Link> : <span>{t("sheetPaused")}</span>
      ) : (
        <a href={sheet.href ?? "#"} target="_blank" rel="noopener noreferrer">{t("openSheet")}</a>
      )}
    </DropdownMenuItem>
  </>
) : null}
```
If `DropdownMenuItem` doesn't support `asChild`, read `src/components/ui/dropdown-menu.tsx` and use its pattern for links; the `p-1.5` padding stays. A paused item without a Settings link (non-Owner) is a disabled item.

Wiring:
- **Meeting page** (`MeetingExport`): `const sheet = useSheetLink(slug, { startsAt: meeting.startsAt, timezone: meeting.timezone });`, then `<ExportMenu onExport={…} sheet={sheet ?? undefined} />`. `settingsHref` is set only for the Owner (from `useWorkspace(slug).data?.myRole`).
- **Attendance:** `useSheetLink(slug)`, which opens the newest tab.

- [ ] **Step 6: Screenshots, and look at them**

`.superpowers/scripts/screens/m7-sheets.spec.ts` (import `./shots`):
- seed through the e2e helpers, or route-mock `GET …/sheet` per state;
- capture Settings > Sheets in each of the five states, plus the three dialogs;
- capture the Home checklist with the Sheets item, Needs attention with a paused sheet, and the meeting page's open Export menu;
- each at 390 light, 320 dark and 1024.

Run: `bun run test:e2e -c .superpowers/scripts/screens/pw.config.ts m7-sheets`

**Open every image.** Check:
- no horizontal scroll at 320 px;
- dialogs centred at 1024 px;
- menu padding;
- targets ≥ 44 px;
- dark mode readable;
- nothing technical in the text.

Fix and re-shoot until clean. Send the set to the Owner with SendUserFile, a contact sheet of the 390 px shots, before merging, and ask "Looks right?". Owner feedback becomes rulings.

- [ ] **Step 7: Full check, commit, PR**

Run the chained check (unit + `TZ=UTC bun run test:e2e`).

```bash
git checkout -b feat/<issue>-m7-sheets-ui
git add src messages
git commit -m "feat: Settings > Sheets, Disconnect copy, Home and Export links"
```
PR with `Closes #<issue>`, labels `type:task`, `area:frontend`, `area:i18n`. Attach three screenshots in the PR body (390 on, 390 paused, 1024 dialog). Then `merge-when-green.sh`.

---
### Task 12: #255: answers and reminders

**Labels:** `type:task`, `area:db`, `area:email`, `area:frontend`. Fixes four #255 items:
1. the time moved back still says "changed";
2. a waiting "not answered" reminder holds back "See you";
3. the reconfirm reminder says "Please answer by…";
4. the reconfirm history row keeps the old `after_deadline`, and an answer from a page opened before a time change clears the new flag.

**Files:**
- Create: `supabase/migrations/<ts>_m7_minors_answers.sql`, `src/server/db/m7-minors-answers.db.test.ts`
- Modify:
  - `src/server/queries/tokens.ts` (+ `seenStartsAt`);
  - `src/shared/api/tokens.ts` (the response body schema);
  - `src/app/api/r/[token]/response/route.ts` (+ test);
  - `src/hooks/use-token-page.ts` (sends `seenStartsAt`);
  - `src/app/r/[token]/reconfirm-banner.tsx` (+ test);
  - `src/server/queries/dispatch.ts` (`reconfirm` in the reservation);
  - `src/server/dispatch/run-dispatch.ts` (+ test);
  - `src/emails/meeting-reminder-email.tsx` (+ test);
  - `messages/en.json`.

**Interfaces:**
- Produces:
  - `private.reminder_waiting(p_invitee uuid, p_audience text) → boolean`, the one "a reminder of this audience is still waiting" rule. Task 13 uses it in `meeting_results`.
  - `public.token_submit_response(p_token_hash, p_status, p_delay_minutes, p_reason, p_comment, p_seen_starts_at timestamptz default null)`.
  - The `Reservation` gains `reconfirm: boolean` (default false).

- [ ] **Step 1: Write the failing DB tests**

`m7-minors-answers.db.test.ts` (use the M6 helpers: `seedMeeting`, `seedContacts`, `seedInvitee`, `serviceRpc`, `jobsOf`, `parkAllJobs`):
1. "a time moved and moved back shows no previous time":
   - edit `starts_at` +1 h, then back (`edit_sent_meeting` as the owner);
   - `token_invitee(hash)` has `meeting.previous_starts_at` = null, and `answer.needs_reconfirmation` stays true (owner ruling M6 Task 6).
2. "a waiting "not answered" reminder never holds back "going"":
   - insert a pending `reminder` job with audience `pending` for the invitee;
   - the person answers Going;
   - `enqueue_reminders(meeting, 'going', 'test')` returns 1.
3. "the reservation tells the reminder that the person must reconfirm":
   - a flagged answer and a claimed `reminder` (pending audience) job;
   - `dispatch_reserve` returns `{ kind: "ok", reconfirm: true }`.
4. "Yes, still going after the deadline writes a history row with after_deadline":
   - the deadline is moved to the past by the service role;
   - the same answer is saved again while flagged;
   - the newest `response_history` row has `after_deadline = true`, and the response's own `after_deadline` is unchanged.
5. "an answer from a page opened before the time change keeps the flag":
   - save with `p_seen_starts_at` = the old start after the edit committed → `needs_reconfirmation` true;
   - with the current start → false.

Run: `supabase db reset --local </dev/null && bun run test:db src/server/db/m7-minors-answers.db.test.ts`
Expected: FAIL on all five.

- [ ] **Step 2: Write the migration**

```sql
-- #255 (M6 minors), answers and reminders.

-- One rule: a reminder of this audience is still waiting for this person (pending, paused or being
-- sent). A waiting "not answered" reminder never holds back "going" (#255).
create function private.reminder_waiting(p_invitee uuid, p_audience text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.outbox_jobs o
    where o.invitee_id = p_invitee and o.kind = 'reminder' and o.status in ('pending', 'paused', 'processing')
      and coalesce(o.payload ->> 'audience', 'pending') = p_audience)
$$;
revoke execute on function private.reminder_waiting(uuid, text) from public, anon, authenticated;
grant execute on function private.reminder_waiting(uuid, text) to service_role;
```

Then:
- **`private.enqueue_reminders`:** copy the latest body (`20261009234223_m6_dispatch_kinds.sql`) and replace the `and not exists (select 1 from public.outbox_jobs o where o.invitee_id = i.id and o.kind = 'reminder' …)` block with `and not private.reminder_waiting(i.id, p_audience)`, keeping the comment.
- **`public.token_invitee`:** copy the latest body (`20261009235635_m6_edit_cancel.sql`) and wrap the `previous_starts_at` subquery:

```sql
      'previous_starts_at', case when r.needs_reconfirmation then pg_catalog.nullif((
        select (mc.changes -> 'starts_at' ->> 0)::timestamptz
        from public.meeting_changes mc
        where mc.meeting_id = m.id and mc.kind = 'edit' and mc.changes ? 'starts_at'
          and mc.changed_at > r.updated_at
        order by mc.changed_at
        limit 1), m.starts_at) end
```

- **`public.dispatch_reserve`:** copy the latest body (`20261010154539_m6_update_calendar_unsubscribed.sql`). In the three `return pg_catalog.jsonb_build_object('kind', 'ok', …)` lines at the end, add `'reconfirm', coalesce(v_job.needs_reconfirmation, false) and v_job.kind = 'reminder'` to each object.
- **`public.token_submit_response`:** the signature changes, so `drop function public.token_submit_response(text, public.response_status, integer, text, text);`. Re-create it with the extra argument `p_seen_starts_at timestamptz default null`, copying the body from `20261009235635_m6_edit_cancel.sql`, with three changes:
  1. in the reconfirm branch, the history insert writes `v_after` instead of `v_new.after_deadline` for `after_deadline`;
  2. add one variable `v_stale boolean := p_seen_starts_at is not null and p_seen_starts_at is distinct from v.starts_at;` (after `v` is loaded; `v.starts_at` is already selected);
  3. the reconfirm branch runs only `if v_old.needs_reconfirmation and not v_stale`, and in the "any new answer" upsert `needs_reconfirmation = false` becomes `needs_reconfirmation = v_stale`.

  Add a comment: "An answer from a page opened before the latest time change confirms the old time, so the person still has to reconfirm (#255)."
- **Grants:** re-grant exactly as `20261008181825_m5_responses.sql` did, for the new signature: `revoke … from public, anon, authenticated; grant … to service_role;`.

Run: `supabase db reset --local </dev/null && bun run db:types && bun run test:db src/server/db/m7-minors-answers.db.test.ts`
Expected: PASS.

- [ ] **Step 3: TypeScript (failing tests first)**

1. **`src/server/queries/tokens.ts`:** `submitResponse` sends `p_seen_starts_at: sqlNullable(input.seenStartsAt ?? null)`.
2. **The response body schema** (`src/shared/api/tokens.ts`) gains `seenStartsAt: z.iso.datetime({ offset: true }).optional()`; the route passes it on. Route test: "passes the start the page showed".
3. **`use-token-page.ts`:** the submit mutation adds `seenStartsAt: info.meeting.startsAt`. Hook test: the body carries it.
4. **`ReconfirmBanner`:** with `meeting.previousStartsAt === null` it shows `t("reconfirmAgain")` ("Please confirm your answer again.") instead of "The time changed to …". Component test for both.
5. **Reservation:** the schema in `src/server/queries/dispatch.ts` gains `reconfirm: z.boolean().default(false)` on `ok`.
   - `run-dispatch.ts` passes `reconfirm: reservation.reconfirm` to `renderMeetingReminderEmail`.
   - `MeetingReminderEmailProps` gains `reconfirm?: boolean`.
   - For `audience === "pending" && reconfirm`, the line is `tr("meetingReminder.reconfirmBy", { deadline })` with a deadline, else `tr("meetingReminder.reconfirm")`:
     - `reconfirmBy`: "The time changed. Please confirm by {deadline} that you can still come."
     - `reconfirm`: "The time changed. Please confirm that you can still come."
   - Email test: both lines, and the old "Please answer by…" isn't in it.
   - Dispatcher test: a reconfirm reservation renders the reconfirm line.

Run: `bun run test src/emails/meeting-reminder-email.test.tsx src/server/dispatch "src/app/r" "src/app/api/r" src/hooks/use-token-page.test.tsx`
Expected: PASS.

- [ ] **Step 4: Full check, commit, PR, merge, hosted push**

Run the chained check, plus `test:db` and advisors.

```bash
git checkout -b fix/<issue>-m7-minors-answers
git add supabase/migrations src messages
git commit -m "fix: #255 answers and reminders (time moved back, reminder holds, reconfirm wording, stale answers)"
```
PR with `Part of #255`, `Closes #<issue>`. Then `merge-when-green.sh`, **`hosted-push.sh`**, and tick the four items in #255's body.

---

### Task 13: #255: edits, cancel, check-in

**Labels:** `type:task`, `area:db`, `area:pipeline`, `area:frontend`. Fixes five #255 items:
1. a reminder dropped silently by a longer lead time;
2. Cancel and Delete wording without Gmail;
3. "28 of 30" at the door;
4. two update emails after a retry during an edit;
5. a change line's "old" value the person was never told.

**Files:**
- Create: `supabase/migrations/<ts>_m7_minors_edits.sql`, `src/server/db/m7-minors-edits.db.test.ts`
- Modify:
  - `src/server/queries/meetings.ts` (edit preview + `remindersSkipped`) and `src/shared/api/meetings.ts`;
  - `src/app/w/[slug]/meetings/[id]/edit/changes-step.tsx` (+ test);
  - `src/server/queries/results.ts` + `src/shared/api/responses.ts` (`checkInTotal`);
  - `src/app/w/[slug]/meetings/[id]/check-in-list.tsx` (+ test);
  - `src/app/w/[slug]/meetings/[id]/meeting-menu.tsx` (+ test);
  - `src/shared/api/errors.ts`, `messages/en.json`.

**Interfaces:**
- Produces:
  - `private.reminder_due(p_meeting public.meetings, p_audience text) → timestamptz` (immutable), used by `sync_reminder_timers` and `edit_sent_meeting`;
  - `private.told_changes(p_changes jsonb, p_meeting uuid, p_told_at timestamptz) → jsonb`;
  - `meeting_invitees.details_told_at`;
  - `edit_sent_meeting` returns `reminders_skipped text[]`;
  - `meeting_results` returns `check_in_total`;
  - the error code `cancel_emails_waiting`.

- [ ] **Step 1: Write the failing DB tests**

`m7-minors-edits.db.test.ts`:
1. "a lead time past the time left is named in the preview and the save":
   - the meeting is in 3 h with "not answered" 24 h before;
   - raising the "going" reminder to 6 h → `edit_sent_meeting(…, dry_run => true)` returns `reminders_skipped: ["going"]`;
   - the save returns the same;
   - no `going` timer exists.
2. "Delete says the cancellation emails wait for Gmail":
   - no sender;
   - cancel a meeting with two sent invites (its `cancel` jobs get paused at the next claim, so call `dispatch_claim` once);
   - `delete_cancelled_meeting` raises `tn:cancel_emails_waiting`;
   - with a sender and pending jobs, it still raises `tn:cancel_emails_pending`.
3. "the check-in total leaves out invites that never went out":
   - 3 sent, 1 failed, 1 skipped;
   - `meeting_results.check_in_total` = 3;
   - after marking the failed one present by hand, it is 4.
4. "a retried update and a newer one send one email with both changes":
   - claim an `update` job, then edit again (a new pending job);
   - `dispatch_retry` on the claimed one;
   - claim again and reserve the old job → `{ kind: "done" }` with `last_error = 'superseded'`;
   - the newer job's payload holds the old job's oldest "old" and the newest "new".
5. "the change line's old value is what the person was last told":
   - invitee A gets an update about place X→Y (finish it as `sent`);
   - invitee B was not targeted (marked `absent`, place rule);
   - a later edit Y→Z;
   - A's new job says `["Y","Z"]`, while B's (now targeted after switching to Going) says `["X","Z"]`.

Run them. Expected: FAIL.

- [ ] **Step 2: Write the migration**

```sql
-- #255 (M6 minors), edits, cancel and check-in.

alter table public.meeting_invitees add column details_told_at timestamptz;
update public.meeting_invitees set details_told_at = sent_at where sent_at is not null;

-- When a reminder is due for this meeting (null: off, or none for this meeting). Twin of the rule
-- sync_reminder_timers used inline before (spec §7.6).
create function private.reminder_due(p_meeting public.meetings, p_audience text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when p_meeting.status <> 'scheduled' or p_meeting.response_mode = 'announcement' or p_meeting.starts_at is null then null
    when p_audience = 'pending' then
      coalesce(p_meeting.response_deadline, p_meeting.starts_at) - pg_catalog.make_interval(hours => p_meeting.reminder_pending_hours)
    else p_meeting.starts_at - pg_catalog.make_interval(hours => p_meeting.reminder_going_hours)
  end
$$;

-- The change lines one person should read: each field's old value is what that person was last told
-- (the earliest change of it after their last details email), and fields that end where they began
-- for them are dropped (#255).
create function private.told_changes(p_changes jsonb, p_meeting uuid, p_told_at timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_object_agg(c.key, pg_catalog.jsonb_build_array(o.old_value, c.value -> 1)), '{}'::jsonb)
  from pg_catalog.jsonb_each(coalesce(p_changes, '{}'::jsonb)) as c
  cross join lateral (
    select coalesce((
      select mc.changes -> c.key -> 0 from public.meeting_changes mc
      where p_told_at is not null and mc.meeting_id = p_meeting and mc.kind = 'edit'
        and mc.changes ? c.key and mc.changed_at > p_told_at
      order by mc.changed_at
      limit 1), c.value -> 0) as old_value
  ) o
  where o.old_value is distinct from c.value -> 1
$$;
revoke execute on function private.reminder_due(public.meetings, text), private.told_changes(jsonb, uuid, timestamptz)
  from public, anon, authenticated;
```

Changes to copied bodies (copy each from the newest migration that defines it; after Tasks 7 and 12 that is their migrations for `dispatch_claim` and `dispatch_reserve`):
- **`private.sync_reminder_timers(uuid, boolean)`** (`20261009235635`): replace the inline `v_due := case … end;` with `v_due := private.reminder_due(v, v_audience);`.
- **`private.edit_sent_meeting`** (`20261009235635`):
  - Declare `v_skipped text[]`.
  - After `v_keys` is known (and before `if p_dry_run`), compute:

```sql
  -- Reminders whose new time is already past would be dropped without a word (#255): name them.
  v_skipped := array(
    select a.audience from pg_catalog.unnest(array['pending', 'going']) as a(audience)
    where v_keys && array['starts_at', 'response_deadline', 'reminder_pending_hours', 'reminder_going_hours']
      and private.reminder_due(v_new, a.audience) <= pg_catalog.now()
      -- A reminder that already went out is not "dropped" when only its settings change.
      and not (not (v_keys && array['starts_at', 'response_deadline']) and exists (
        select 1 from public.outbox_jobs j
        where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
          and j.status = 'done' and j.payload ->> 'audience' = a.audience)));
```
  - Add `'reminders_skipped', pg_catalog.to_jsonb(v_skipped)` to **both** returned objects (dry run and save), and `'reminders_skipped', '[]'::jsonb` to the "nothing changed" one.
  - In the enqueue, `targets` joins `public.meeting_invitees ti on ti.id = t.invitee_id`, and both payload builders use `private.told_changes(v_visible, p_meeting, coalesce(ti.details_told_at, ti.invited_at))` instead of `v_visible`. Split the `merged` CTE's `from targets t` into `from targets t join public.meeting_invitees ti on ti.id = t.invitee_id`.
- **`public.dispatch_finish`** (`20261009234223`): after the calendar block, before `return;` in the `v_kind <> 'invite'` branch, add
  ```sql
  if v_kind = 'update' and p_outcome in ('sent', 'unknown') and coalesce((v_payload ->> 'notify')::boolean, false) then
    update public.meeting_invitees set details_told_at = pg_catalog.now() where id = v_invitee;
  end if;
  ```
  In the invite update, add `details_told_at = case when p_outcome in ('sent', 'unknown') then pg_catalog.now() else details_told_at end`.
- **`public.dispatch_claim`** (from Task 7's migration): the lost-lease invite branch also sets `details_told_at = pg_catalog.now()`.
- **`public.dispatch_reserve`** (from Task 12's migration): at the top of the `else` branch (non-invite kinds), before `v_wanted`, add:

```sql
    -- An update requeued (retry, quota) while a newer one waits: fold it into the newer one so the
    -- person gets one email with both changes (#255).
    if v_job.kind = 'update' then
      update public.outbox_jobs n
      set payload = private.merge_update_payload(v_job.payload, n.payload)
      where n.invitee_id = v_job.invitee_id and n.kind = 'update' and n.status in ('pending', 'paused') and n.id <> p_job;
      if found then
        update public.outbox_jobs set status = 'done', locked_until = null, last_error = 'superseded' where id = p_job;
        return pg_catalog.jsonb_build_object('kind', 'done');
      end if;
    end if;
```

- **`private.meeting_results`** (`20261009235635`):
  - `reminder_waiting` in `inv` becomes `private.reminder_waiting(i.id, 'pending')`. Nudge counts the "not answered" audience, as in Task 12.
  - Add `inv.email_status` to `inv`, and the output gets `'check_in_total', (select count(*) from inv where inv.email_status in ('sent', 'unknown') or inv.marked)`.
- **`private.delete_cancelled_meeting`** (`20261009235635`): before the existing `cancel_emails_pending` check, add:

```sql
  -- Waiting for Gmail (paused) is not "going out in a few minutes" (#255).
  if exists (select 1 from public.outbox_jobs j where j.meeting_id = p_meeting and j.kind = 'cancel' and j.status = 'paused')
    and v_meeting.starts_at > pg_catalog.now()
    and not exists (select 1 from public.outbox_jobs j where j.meeting_id = p_meeting and j.kind = 'cancel' and j.status in ('pending', 'processing')) then
    raise exception 'tn:cancel_emails_waiting' using errcode = 'P0001';
  end if;
```

Grant `private.reminder_due` / `private.told_changes` to nothing beyond the definer bodies. `reminder_due` is also called by `sync_reminder_timers`, an invoker running inside definer callers, so check with `has_function_privilege` as in Task 7 and grant to `service_role` only if a service-role path calls it.

Run: `supabase db reset --local </dev/null && bun run db:types && bun run test:db`
Expected: PASS, including every M6 DB test.

- [ ] **Step 3: TypeScript and UI (failing tests first)**

1. **`cancel_emails_waiting`:** add it to `API_ERROR_CODES` / `API_ERROR_STATUS` (409) / `ApiErrors`: "The cancellation emails are waiting for Gmail. Reconnect Gmail, then delete the meeting once they've gone out."
2. **The edit preview** (`src/server/queries/meetings.ts` and `src/shared/api/meetings.ts`) gains `remindersSkipped: z.array(z.enum(["pending", "going"])).default([])`. In `changes-step.tsx`, each skipped audience adds one line to the "What happens" list:
   - `t("changes.reminderSkipped.pending")`: "The reminder for people who haven't answered would be in the past, so it won't be sent."
   - `t("changes.reminderSkipped.going")`: "The reminder for people who are going would be in the past, so it won't be sent."

   Component test: the line shows for `remindersSkipped: ["going"]` and not for `[]`.
3. **`meeting_results`'s `check_in_total`** becomes `checkInTotal` in `meetingResultsSchema`. `check-in-list.tsx` shows `t("count", { done: results.checkedIn, total: results.checkInTotal })`. Component test with 3 sent and 1 failed.
4. **`MeetingMenu`**, when `results?.senderState !== "ok"`:
   - the Cancel dialog's `description` is `t("cancel.bodyWaiting")`: "Everyone invited gets a cancellation email once Gmail is connected again, and it is removed from calendars. This can't be undone.";
   - the done toast is `t("cancel.doneWaiting")`: "Meeting cancelled. The cancellation emails will go out once Gmail is connected again.";
   - a Delete that fails with `cancel_emails_waiting` shows its ApiErrors text.

   Component tests: the waiting wording with `senderState: "missing"`; the normal wording with `"ok"`.

Run: `bun run test "meetings/\[id\]" src/server/queries src/shared`
Expected: PASS.

- [ ] **Step 4: Screenshots of the changed bits**

Add the three changed views (Review changes with a skipped reminder, the check-in count, the Cancel dialog without Gmail) to `.superpowers/scripts/screens/m7-sheets.spec.ts`, or a new `m7-minors.spec.ts`. Shoot at 390 light / 320 dark / 1024, then look.

- [ ] **Step 5: Full check, commit, PR, merge, hosted push**

```bash
git checkout -b fix/<issue>-m7-minors-edits
git add supabase/migrations src messages .superpowers/scripts/screens
git commit -m "fix: #255 edits, cancel and check-in (skipped reminders, waiting cancels, door total, one update, told values)"
```
PR with `Part of #255`, `Closes #<issue>`. Then `merge-when-green.sh`, **`hosted-push.sh`**, and tick the five items.

---

### Task 14: #255: rate limits, a grant, query plans, two flakes, three nits

**Labels:** `type:task`, `area:db`, `area:frontend`.

**Files:**
- Create: `supabase/migrations/<ts>_m7_minors_hardening.sql`
- Modify:
  - `src/server/db/m6-check-in.db.test.ts`, `src/server/db/results.db.test.ts`, `src/server/db/function-security.db.test.ts`;
  - `src/test/db/plans.ts` (the role parameter, if Task 7 didn't add it);
  - `src/app/w/[slug]/meetings/[id]/edit/add-people-sheet.test.tsx`, `e2e/design-system.spec.ts`;
  - `src/lib/meetings/deadline.ts`, `src/app/w/[slug]/meetings/[id]/edit/reminder-choice.tsx` (or wherever `reminder-choice.tsx` lives: `grep -rln "workspace default" src`), `src/server/dispatch/run-dispatch.ts`.

- [ ] **Step 1: The rate limits, with failing tests first**

In `m6-check-in.db.test.ts`, add:
- "check-in taps are rate limited per user": `overrideLimit("check_in_marks_per_user_per_hour", 2)`, three `mark_attendance` calls, and the third raises `tn:rate_limited`;
- the same for `mark_rest_as_declared` with `check_in_rests_per_user_per_hour`.

Run them. Expected: FAIL.

Migration:
- `insert into private.app_limits (name, value) values ('check_in_marks_per_user_per_hour', 3000), ('check_in_rests_per_user_per_hour', 60);`
- `hit_user_rate_limit`: copy from Task 6's migration and add `when 'check_in_mark' then 'check_in_marks_per_user_per_hour'` and `when 'check_in_rest' then 'check_in_rests_per_user_per_hour'`.
- `mark_attendance` / `mark_rest_as_declared`: copy from `20261010173301_m6_check_in_late_minutes.sql`, and after their permission checks add `if not private.hit_user_rate_limit('check_in_mark' | 'check_in_rest') then raise exception 'tn:rate_limited' using errcode = 'P0001'; end if;`.

The check-in UI already maps `rate_limited` through `ApiErrors`. Check `check-in-row.tsx` / `use-check-in.ts` show the toast; add a hook test if not.

- [ ] **Step 2: The grant**

Add to `function-security.db.test.ts`: "service_role cannot nudge":
```ts
select has_function_privilege('service_role', 'public.nudge_meeting(uuid)', 'execute')
```
is false. Run it. Expected: FAIL. Then add to the migration:
```sql
revoke execute on function public.nudge_meeting(uuid) from service_role;
```
Run it again. Expected: PASS.

- [ ] **Step 3: The query plans**

Add to `results.db.test.ts`'s "query plans (fresh and stale statistics)" block, in the same style:
1. "the reminder fan-out reads only due timers": seed 500 pending per-person reminder jobs and 3 due timers, run `analyze public.outbox_jobs`, then `explainCall("public.dispatch_claim('<uuid>', 1, 60)", …, "service_role")`. The plan uses `outbox_jobs_due_timers_idx`.
2. "the claim's hold check uses the invitee key": the same plan shows `meeting_invitees_pkey` for `job_held`'s probe. If the planner inlines it as a semi-join instead, assert there's no `Seq Scan on meeting_invitees`.
3. Stale variants: right after the bulk inserts and without `analyze`, `contact_history`, `attendance_summary`, `attendance_details` and the check-in page read (`meeting_people` with the check-in filter, or the check-in RPC by its real name) keep their index plans, using the existing `usesMeetingIndex` / `planUsesIndex` assertions.

Run them. They should pass, unless a plan is wrong. A test that passes before any change is fine here: these are regression guards, as #255 asks. If one fails, it's a real plan problem; follow `superpowers:systematic-debugging`, fix it in this migration (an index or a rewrite), and record a ruling.

- [ ] **Step 4: The two flakes**

1. **`add-people-sheet.test.tsx`** ("adds several people…", about 5.4 s): create `const user = userEvent.setup({ delay: null });` once per test and use `user.type` / `user.click` instead of the `userEvent.*` calls. For the multi-line paste box use `await user.click(box); await user.paste("Sami, sami@uni.tn\nLina <lina@uni.tn>")`. Expected: the test takes under 1 s; run it 10 times with `bun run test add-people-sheet --repeat=10` if supported, else in a loop.
2. **`e2e/design-system.spec.ts`**, the "first paint" tests: the flake is the background read before the stylesheet applies under load. Assert what first paint is decided by, then wait for the styles:
   ```ts
   await page.goto("/design", { waitUntil: "commit" });
   await page.waitForSelector("body");
   await expect(page.locator("html")).toHaveClass(/light/);
   await expect
     .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
     .toBe("rgb(243, 238, 255)");
   ```
   Use `/dark/` with `rgb(22, 19, 31)` for the dark cases. Read `src/app/layout.tsx` first to confirm next-themes' `attribute`: a class or `data-theme`. Assert that exact attribute. Run under load: `TZ=UTC bun run test:e2e design-system --repeat-each=20 --workers=4`. Expected: 0 failures.

- [ ] **Step 5: The three nits**

- `src/lib/meetings/deadline.ts`: the JSDoc names `private.response_deadline_problem` as the DB twin (not `send_meeting`).
- `reminder-choice.tsx`: the JSDoc says the options come from the config constants (`REMINDER_PENDING_CHOICES` / `REMINDER_GOING_CHOICES`), not "workspace default".
- `run-dispatch.ts`, the `update` case: drop the type-only `meeting: { ...common.meeting, footerNote: job.meeting.footerNote }` spread if `common.meeting` already carries `footerNote`. Check the type of `MeetingInviteEmailProps["meeting"]`; if it doesn't carry it, add `footerNote` where `common` is built, so the spread disappears. The dispatcher tests must stay green.

- [ ] **Step 6: Full check, commit, PR, merge, hosted push, close #255**

Run the chained check, plus `test:db`, `TZ=UTC bun run test:e2e` and advisors.

```bash
git checkout -b fix/<issue>-m7-minors-hardening
git add supabase/migrations src e2e
git commit -m "fix: #255 rate limits, nudge grant, plan checks, two flakes, JSDoc"
```
PR with `Closes #255`, `Closes #<issue>`. Then `merge-when-green.sh` and **`hosted-push.sh`**. Confirm #255 shows every item ticked and closed.

---
### Task 15: Rollout: e2e story, final review, production check, evidence

**Labels:** `type:task`, `area:infra`, `area:docs`. **Owner involvement: the production check.**

**Files:**
- Rename: `e2e/helpers/fake-gmail.ts` → `e2e/helpers/fake-google.ts` (Gmail + Sheets + Drive in one fake, plus the token endpoint)
- Create: `e2e/m7-sheet.spec.ts`, `e2e/helpers/seed-sheet.ts`
- Modify: `playwright.config.ts` (env), `e2e/helpers/seed-sender.ts` (scopes option), every e2e import of `fake-gmail`, spec §14 (M7 row evidence), the memories

- [ ] **Step 1: The fake Google**

Rename the file and keep every Gmail route. Add:
- `POST /drive/v3/files`: create, storing `appProperties`; reply `{ id: "f-<n>" }`.
- `GET /drive/v3/files?q=…`: match `tapnshow_create_key`; reply `{ files: [...] }`.
- `GET /drive/v3/files/<id>?fields=trashed`.
- `GET /v4/spreadsheets/<id>?fields=…`: tabs from the stored state; a new file has `[{ sheetId: 0, title: "Sheet1", index: 0 }]`.
- `POST /v4/spreadsheets/<id>:batchUpdate`: apply `addSheet`, `deleteSheet`, `updateSheetProperties` (title, row count), `updateCells` (store the values by sheet id) and `addConditionalFormatRule` / `addSlicer` (count them); ignore other kinds.
- `GET /__sheets`: every file with its tabs, values, rule counts and slicers, for assertions.
- `POST /__sheets/trash/<id>`: flip `trashed`, to test the pause.

`playwright.config.ts`: add `GOOGLE_SHEETS_API_BASE_URL: FAKE_GOOGLE_URL` and `GOOGLE_DRIVE_API_BASE_URL: FAKE_GOOGLE_URL`.

`e2e/helpers/seed-sheet.ts`, with the service-role client like `seed-sender.ts`:
- `seedSheetConnection(userId, workspaceId)` seals a fake token with scopes `[gmail.send, drive.file]` and inserts `sheet_syncs` (no file);
- `makeSheetDue(workspaceId)` moves `sheet_dirty_years.changed_at` / `first_changed_at` back 2 minutes;
- `runWorkers()` POSTs `/api/internal/dispatch` with `E2E_DISPATCH_SECRET`.

- [ ] **Step 2: Write the M7 story**

`e2e/m7-sheet.spec.ts` uses `test.use({ timezoneId: "Africa/Tunis" })` and sends **two days ahead**:
1. The Owner signs in and creates a workspace. Then: `seedSender`, `seedSheetConnection`, import 3 people, `sendMeetingThroughUi(page, slug, { daysAhead: 2 })`.
2. `runWorkers()`, `makeSheetDue`, `runWorkers()`. `/__sheets` now has one file named "<Workspace> · TapNShow" with a tab titled with this year, holding 3 rows in name order, "No reply" in Answer, 10 rules and 1 slicer.
3. Open one invitee's answer link (as in `e2e/responses.spec.ts`) and answer "I'll be late" with 15 min. Then `makeSheetDue` and `runWorkers()`. That row's Answer reads "Late by 15 min" and its hidden tone column "warning".
4. Settings > Sheets shows "Up to date" and **Open the Google Sheet**. The meeting page's Export menu has "Open the Google Sheet", whose href ends with `#gid=0`.
5. `POST /__sheets/trash/<id>`, answer again, `makeSheetDue`, `runWorkers()`. Settings shows "Paused" and the trash line; the Owner's inbox in Mailpit has "The Google Sheet of … stopped updating".
6. Untrash, tap **Try again**, `runWorkers()`. The sheet is "Up to date", and the latest answer is in the sheet.
7. **Turn off the Google Sheet** → confirm. The section shows Off, and `/__sheets` still has the file.
8. As a Viewer, added with `addMember` in setup: Settings > Sheets shows the viewer lines, and no Turn off.

Run: `TZ=UTC bun run test:e2e m7-sheet`
Expected: PASS on both projects. Then the full suite: `TZ=UTC bun run test:e2e`.

- [ ] **Step 3: Final review (fresh reviewer)**

Use `superpowers:requesting-code-review` with a fresh reviewer (`model: "opus"`) over `git diff <M7 base>..origin/main`, where the base is the commit before Task 2 merged.

Give it:
- spec §4, §6–§9, §7.17 and §11–§12;
- this plan's Global Constraints and Review Focus;
- the instruction to append findings to `.superpowers/sdd/2026-10-10-m7-google-sheet/review.md` as it goes (usage-limit deaths lose unsaved findings).

Grade the findings (Critical / Important / Minor). Fix Critical and Important in one PR, `fix: M7 final review`, through `superpowers:receiving-code-review`. Put the remaining minors in a new issue "M7 minors" under epic #10 (M8).

- [ ] **Step 4: Production check with the Owner**

The Owner's Google Cloud setup was done in Task 1. Confirm in the console that both APIs are still enabled and `drive.file` is listed.

AskUserQuestion with the checklist. Use the Owner's **test workspace** and their **test** Google account only:
1. Settings > Sheets: Connect Google Sheets → read the confirm → Continue to Google → pick the test account and keep the Drive box ticked.
2. Within a minute, Settings shows "Up to date". Open the sheet: this year's tab, the title band and the header in the app's look, the Meeting filter box, answers tinted.
3. Send a test meeting to your own four inboxes (as in M6). Answer from one inbox, and within about two minutes the row shows the answer.
4. Check one person in at the door after the start, or use an already started test meeting. Their row shows it.
5. Share the sheet **view-only** with a second test account. In a private window, the Meeting filter box hides other meetings for that viewer only.
6. Move the file to the Drive trash. Within two minutes, Settings shows Paused with the trash line, and your inbox has "The Google Sheet of … stopped updating". Restore it, tap Try again, and it is "Up to date" again.
7. Turn off the Google Sheet. The file stays in Drive.

Record the counts and outcomes in the ledger, counts only, with no names or emails.

Read-only checks with the helpers:
- `.superpowers/scripts/prod-status.ts "<test meeting title>"`;
- Sentry (`search_issues`, org `dev-daly`, region `https://de.sentry.io`, the last 24 h): no new unresolved issues.

- [ ] **Step 5: Evidence and close**

1. Spec §14 M7 row: replace "Done when" with "**Done <date>:** …". Write the production outcomes (counts only), the test totals (`unit N, DB N, e2e N`), the advisors, Sentry, the final-review counts and the fix PR, and the S6 result. PR `docs: M7 done (spec §14 evidence)`.
2. Post every ruling from the ledger as one comment on epic #9. Then close the task issues, #255, epic #9 and milestone "M7 Google Sheets sync".
3. Memories:
   - replace `m6-done-open-items.md` with `m7-done-open-items.md`, holding what is still open: the club workspace send, S4 if it's still open, #221 retest, M7 minors, and M8 next;
   - update `MEMORY.md`.
4. Use `superpowers:finishing-a-development-branch` and `commit-commands:clean_gone`. **Ask before deleting branches**, and before deleting the ledger folder (the M6 close deleted it after posting the rulings, as the skill requires).
5. Stop the brainstorm server: `bash ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/brainstorming/scripts/stop-server.sh .superpowers/brainstorm/<session>`.

---

## Self-review (done while writing; re-run after any amendment)

- **Spec coverage:**
  - §4 → Tasks 4, 11;
  - §5 / §8 → Tasks 7, 8;
  - §6 → Tasks 3, 6, 7;
  - §7.3 → Task 7 triggers;
  - §7.17 → Tasks 4, 6, 9, 11;
  - §9 → Tasks 6, 9;
  - §10 → Task 10;
  - §11 → Tasks 6, 9, 15;
  - §12 → each task's tests and Task 15;
  - §13 S6 → Task 1;
  - §14 → Task 15;
  - §15 → Task 1 Step 1.
- **Placeholders:** the task numbers in branch names and `Closes #<issue>` are filled from the Tracking step. `<ts>` is the CLI's migration timestamp. Nothing else is left open.
- **Type consistency:** `SheetSourceRow`, `PlannedTab`, `TabContent`, `StoredTab`, `SheetClaim`, `SheetStore`, `SheetsDeps`, `GoogleSheetsClient`, `GoogleFailure`, `ReleasedConnection`, `SheetPauseReason`, `GoogleConnectPurpose`, `SheetStatus` and `Worker` are named the same in every task that uses them. The RPC names in Task 7 equal the store's calls in Task 8.
- **Review Focus:** each of the five lines names the task and test that pins it.
