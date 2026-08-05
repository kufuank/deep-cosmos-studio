-- PostgREST builds one column list from the union of objects in a multi-row
-- insert and writes NULL wherever a row omits a key, so a row that legitimately
-- has nothing to report still hits the NOT NULL constraint. For a list column an
-- absent value and an empty list mean the same thing, so normalise rather than
-- reject — the constraint stays, but this footgun stops being fatal.
create or replace function public.dc_normalise_wrote()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.wrote is null then
    new.wrote := '{}'::text[];
  end if;
  return new;
end;
$$;

revoke all on function public.dc_normalise_wrote() from public, anon, authenticated;

drop trigger if exists dc_messages_wrote_default on public.dc_messages;
create trigger dc_messages_wrote_default before insert or update on public.dc_messages
  for each row execute function public.dc_normalise_wrote();
