-- VCL V1.1.1: Public, login-independent news feed
-- Run this once in Supabase -> SQL Editor.
--
-- The public website must not depend on an authenticated session to read news.
-- This view only exposes rows that are already published, so drafts and archived
-- posts remain unavailable through the public endpoint.

create or replace view public.public_news_posts_view as
select
  id,
  slug,
  title,
  excerpt,
  body,
  category,
  status,
  is_pinned,
  published_at,
  created_at
from public.news_posts
where status = 'published';

revoke all on public.public_news_posts_view from public;
grant select on public.public_news_posts_view to anon, authenticated;

-- Refresh PostgREST's schema cache immediately.
notify pgrst, 'reload schema';
