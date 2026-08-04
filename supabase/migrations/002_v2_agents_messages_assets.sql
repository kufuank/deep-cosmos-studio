-- Phase 3 v2: agent instructions become versioned data so the improvement-
-- proposal loop from the source documents can actually run; chat and assets get
-- their own tables.
--
-- Card field schemas deliberately stay in TypeScript: they are the fixed spec
-- transcribed from the master prompt templates and the frontend needs them typed.

create table if not exists public.dc_agents (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users(id) on delete cascade,  -- null = built-in
  agent text not null,
  version int not null default 1,
  active boolean not null default true,
  role text not null,
  knowledge text not null default '',
  protocol text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists dc_agents_active_builtin_idx
  on public.dc_agents(agent) where owner is null and active;
create unique index if not exists dc_agents_active_owner_idx
  on public.dc_agents(owner, agent) where owner is not null and active;

create table if not exists public.dc_protocol_proposals (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  agent text not null,
  from_version int not null,
  proposed_protocol text not null,
  rationale text not null default '',
  expected_benefit text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.dc_messages (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.dc_cards(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  text text not null default '',
  wrote text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists dc_messages_card_idx on public.dc_messages(card_id, created_at);

alter table public.dc_cards drop column if exists chat;

create table if not exists public.dc_assets (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.dc_cards(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('sheet','still','video')),
  prompt text not null,
  provider text,
  storage_path text,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists dc_assets_card_idx on public.dc_assets(card_id, created_at desc);

create table if not exists public.dc_reference_items (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  card_id uuid references public.dc_cards(id) on delete set null,
  agent text not null,
  title text not null default '',
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index if not exists dc_reference_agent_idx on public.dc_reference_items(owner, agent);

alter table public.dc_agents             enable row level security;
alter table public.dc_protocol_proposals enable row level security;
alter table public.dc_messages           enable row level security;
alter table public.dc_assets             enable row level security;
alter table public.dc_reference_items    enable row level security;

-- Built-in agent configs are shared reference data; overrides are private.
drop policy if exists dc_agents_read on public.dc_agents;
create policy dc_agents_read on public.dc_agents
  for select to authenticated
  using (owner is null or owner = (select auth.uid()));

drop policy if exists dc_agents_write_own on public.dc_agents;
create policy dc_agents_write_own on public.dc_agents
  for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists dc_proposals_own on public.dc_protocol_proposals;
create policy dc_proposals_own on public.dc_protocol_proposals
  for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists dc_messages_own on public.dc_messages;
create policy dc_messages_own on public.dc_messages
  for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists dc_assets_own on public.dc_assets;
create policy dc_assets_own on public.dc_assets
  for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists dc_reference_own on public.dc_reference_items;
create policy dc_reference_own on public.dc_reference_items
  for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
