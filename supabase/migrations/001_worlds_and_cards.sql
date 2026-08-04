-- Deep Cosmos Studio (phase 3). Namespaced with a dc_ prefix so the existing
-- phase 1/2 tables in this project are untouched.

create table if not exists public.dc_worlds (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null default 'İsimsiz Dünya',
  brief text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dc_cards (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.dc_worlds(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('planet','ecosystem','species','location')),
  parent_id uuid references public.dc_cards(id) on delete cascade,
  title text not null default '',
  fields jsonb not null default '{}'::jsonb,
  chat jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','locked')),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dc_worlds_owner_idx on public.dc_worlds(owner, updated_at desc);
create index if not exists dc_cards_world_idx on public.dc_cards(world_id, type);
create index if not exists dc_cards_parent_idx on public.dc_cards(parent_id);

create or replace function public.dc_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dc_worlds_touch on public.dc_worlds;
create trigger dc_worlds_touch before update on public.dc_worlds
  for each row execute function public.dc_touch_updated_at();

drop trigger if exists dc_cards_touch on public.dc_cards;
create trigger dc_cards_touch before update on public.dc_cards
  for each row execute function public.dc_touch_updated_at();

-- A locked card is immutable except for being unlocked again. The protocols
-- require that locking freezes the sheet.
create or replace function public.dc_guard_locked_card()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'locked' and new.status = 'locked'
     and (new.fields is distinct from old.fields or new.title is distinct from old.title) then
    raise exception 'Kilitli kart değiştirilemez. Önce kilidi açın.';
  end if;
  return new;
end;
$$;

drop trigger if exists dc_cards_lock_guard on public.dc_cards;
create trigger dc_cards_lock_guard before update on public.dc_cards
  for each row execute function public.dc_guard_locked_card();

-- Trigger functions are not RPC endpoints.
revoke all on function public.dc_touch_updated_at() from public, anon, authenticated;
revoke all on function public.dc_guard_locked_card() from public, anon, authenticated;

alter table public.dc_worlds enable row level security;
alter table public.dc_cards enable row level security;

drop policy if exists dc_worlds_owner_all on public.dc_worlds;
create policy dc_worlds_owner_all on public.dc_worlds
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists dc_cards_owner_all on public.dc_cards;
create policy dc_cards_owner_all on public.dc_cards
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));
