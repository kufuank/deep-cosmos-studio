-- Reference videos can now arrive as links through the local fetch helper
-- (tools/fetch-helper). YouTube keeps its own kind; any other site — Instagram,
-- TikTok, Vimeo, a direct mp4 — is 'url'. source_ref holds the link itself.

alter table public.dc_shot_lists drop constraint if exists dc_shot_lists_source_kind_check;
alter table public.dc_shot_lists
  add constraint dc_shot_lists_source_kind_check
  check (source_kind in ('file', 'youtube', 'url'));
