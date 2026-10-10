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
