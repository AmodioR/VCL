-- VCL 2.1 stabilization
-- READ ONLY
-- Purpose: determine whether legacy team_invites.sent_by_profile_id can be retired.

select
  '01_COUNTS' as section,
  'team_invites' as object_name,
  jsonb_build_object(
    'total_rows', count(*),
    'sent_by_profile_id_rows', count(*) filter (where sent_by_profile_id is not null),
    'invited_by_profile_id_rows', count(*) filter (where invited_by_profile_id is not null),
    'invited_by_player_id_rows', count(*) filter (where invited_by_player_id is not null)
  ) as details
from public.team_invites;

select
  '02_VIEW_REFERENCE' as section,
  schemaname || '.' || viewname as object_name,
  jsonb_build_object('definition', definition) as details
from pg_views
where schemaname = 'public'
  and lower(definition) like '%sent_by_profile_id%'
order by viewname;

select
  '03_FUNCTION_REFERENCE' as section,
  n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object_name,
  jsonb_build_object(
    'definition', pg_get_functiondef(p.oid),
    'security_definer', p.prosecdef
  ) as details
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
  and lower(pg_get_functiondef(p.oid)) like '%sent_by_profile_id%'
order by p.proname;

select
  '04_POLICY_REFERENCE' as section,
  policyname as object_name,
  jsonb_build_object(
    'command', cmd,
    'using', qual,
    'with_check', with_check
  ) as details
from pg_policies
where schemaname = 'public'
  and tablename = 'team_invites'
  and (
    lower(coalesce(qual, '')) like '%sent_by_profile_id%'
    or lower(coalesce(with_check, '')) like '%sent_by_profile_id%'
  )
order by policyname;

select
  '05_CONSTRAINT' as section,
  c.conname as object_name,
  jsonb_build_object('definition', pg_get_constraintdef(c.oid)) as details
from pg_constraint c
join pg_class rel on rel.oid = c.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname = 'team_invites'
  and lower(pg_get_constraintdef(c.oid)) like '%sent_by_profile_id%'
order by c.conname;