-- Phase 3: the Storyboard agent. A storyboard is a card like the others — it
-- inherits the four locked identity sheets and gets chat via dc_messages for
-- free — but its core output is an ordered scene list rather than a field sheet,
-- so scenes live in their own column. It also points at the shot list whose
-- sequence it adapts, which is what keeps the adaptation honest: the agent
-- preserves measured shot durations instead of inventing pacing.

alter table public.dc_cards drop constraint if exists dc_cards_type_check;
alter table public.dc_cards add constraint dc_cards_type_check
  check (type in ('planet','ecosystem','species','location','storyboard'));

alter table public.dc_cards add column if not exists scenes jsonb not null default '[]'::jsonb;
alter table public.dc_cards add column if not exists shot_list_id uuid
  references public.dc_shot_lists(id) on delete set null;

-- Locking must freeze scenes too, or an approved storyboard could still drift.
create or replace function public.dc_guard_locked_card()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'locked' and new.status = 'locked'
     and (new.fields is distinct from old.fields
          or new.title is distinct from old.title
          or new.scenes is distinct from old.scenes) then
    raise exception 'Kilitli kart değiştirilemez. Önce kilidi açın.';
  end if;
  return new;
end;
$$;
