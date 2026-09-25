-- Adds the outline-approval stage to an already-created schema.
-- Run once in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Safe to run even if some of this already exists (uses IF NOT EXISTS /
-- DROP...IF EXISTS before re-adding), so it won't error on a partial re-run.

alter table notes add column if not exists outline_text text;
alter table notes add column if not exists outline_message_ids integer[] not null default '{}';

alter table notes drop constraint if exists notes_status_check;
alter table notes add constraint notes_status_check
  check (status in ('pending', 'scored_low', 'scored_high', 'outline_sent', 'drafted'));

create index if not exists notes_outline_ids_idx on notes using gin (outline_message_ids);
