-- VCL 2.1 stabilization
-- READ ONLY
-- Purpose: confirm whether legacy roster_posts contains data worth preserving
-- before any retirement migration is considered.

select
  '01_COUNTS' as section,
  'roster_posts' as object_name,
  jsonb_build_object(
    'row_count', count(*),
    'active_count', count(*) filter (where status = 'active'),
    'inactive_count', count(*) filter (where status is distinct from 'active'),
    'oldest_created_at', min(created_at),
    'newest_created_at', max(created_at),
    'newest_updated_at', max(updated_at)
  ) as details
from public.roster_posts;

select
  '02_SAMPLE' as section,
  coalesce(id::text, '(no id)') as object_name,
  to_jsonb(rp) as details
from public.roster_posts rp
order by coalesce(updated_at, created_at) desc nulls last
limit 10;
