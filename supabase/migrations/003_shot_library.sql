-- Phase 2: the Production Shot Library. Reference videos are reverse-engineered
-- into shot lists, which later feed the Storyboard Agent as its cinematographic
-- source. Columns follow the Deconstruction Agent protocol exactly.
--
-- Cut boundaries are measured in the browser (see src/lib/video.ts) rather than
-- guessed by the model, so start/end seconds are trustworthy and sequences can
-- later be selected by real duration and pacing.

create table if not exists public.dc_shot_lists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  source_kind text not null default 'file' check (source_kind in ('file','youtube')),
  source_ref text not null default '',
  duration_seconds numeric,
  status text not null default 'draft' check (status in ('draft','analyzing','ready','locked','failed')),
  error text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dc_shots (
  id uuid primary key default gen_random_uuid(),
  shot_list_id uuid not null references public.dc_shot_lists(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  ordinal int not null,
  start_seconds numeric not null default 0,
  end_seconds numeric not null default 0,
  timecode_start text not null default '',
  timecode_end text not null default '',
  shot_type text not null default '',
  camera_angle text not null default '',
  camera_movement text not null default '',
  lens text not null default '',
  dof text not null default '',
  main_subject text not null default '',
  primary_action text not null default '',
  foreground text not null default '',
  background text not null default '',
  composition text not null default '',
  lighting text not null default '',
  camera_purpose text not null default '',
  continuity_notes text not null default '',
  technical_notes text not null default '',
  audio_notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists dc_shots_list_idx on public.dc_shots(shot_list_id, ordinal);
create unique index if not exists dc_shots_list_ordinal_idx on public.dc_shots(shot_list_id, ordinal);

drop trigger if exists dc_shot_lists_touch on public.dc_shot_lists;
create trigger dc_shot_lists_touch before update on public.dc_shot_lists
  for each row execute function public.dc_touch_updated_at();

alter table public.dc_shot_lists enable row level security;
alter table public.dc_shots      enable row level security;

drop policy if exists dc_shot_lists_own on public.dc_shot_lists;
create policy dc_shot_lists_own on public.dc_shot_lists
  for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists dc_shots_own on public.dc_shots;
create policy dc_shots_own on public.dc_shots
  for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
