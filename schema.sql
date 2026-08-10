-- Run this once in the Supabase SQL editor.
-- One row per user holding the whole app state as JSON.

create table if not exists public.cp_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cp_state enable row level security;

-- Each user can only ever see or touch their own row.
create policy "read own state"   on public.cp_state
  for select using (auth.uid() = user_id);

create policy "insert own state" on public.cp_state
  for insert with check (auth.uid() = user_id);

create policy "update own state" on public.cp_state
  for update using (auth.uid() = user_id)
             with check (auth.uid() = user_id);
