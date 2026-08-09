-- Signing in is not the same as being allowed to spend the shared Anthropic key.
--
-- The site is public and signup was open, so anyone who found the URL could
-- register, obtain a valid session, and bill the project owner. Three accounts
-- with disposable addresses did exactly that before this landed.
--
-- The edge function checks this table on every request and fails closed: if the
-- list cannot be read, the request is denied rather than waved through. Its GET
-- health endpoint reports `allowlist_readable` so a misconfiguration surfaces as
-- a diagnostic instead of locking everyone out silently.
--
-- Rows are NOT seeded here on purpose: this repository is public and the entries
-- are real personal email addresses. Add them directly against the database:
--
--   insert into public.dc_allowed_users (email, note)
--   values ('someone@example.com', 'Ekip')
--   on conflict (email) do nothing;

create table if not exists public.dc_allowed_users (
  email text primary key,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.dc_allowed_users enable row level security;

-- Deliberately no policy. Only the service role reads this, and the edge
-- function is the only thing holding that key, so anon and authenticated get
-- nothing — the allowlist itself is not a list of emails anyone can enumerate.
