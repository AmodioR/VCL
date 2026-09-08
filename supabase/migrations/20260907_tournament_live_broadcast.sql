-- VCL 2.1 — Tournament-level livestream
-- Adds one broadcast URL to a tournament. Existing RLS on public.tournaments
-- already limits writes to VCL admins and allows public reads for published events.

alter table public.tournaments
  add column if not exists stream_url text;

comment on column public.tournaments.stream_url is
  'Optional public livestream URL used on the tournament page and global LIVE bar.';
