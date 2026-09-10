-- VCL 2.1 stabilization
-- READ ONLY
-- Purpose: determine whether the two live team_invites recipient models are both
-- still in use before consolidating RLS or schema.

with counts as (
  select
    count(*) as total_rows,
    count(*) filter (where status = 'pending') as pending_rows,
    count(*) filter (where player_id is not null) as player_id_rows,
    count(*) filter (where invited_profile_id is not null) as invited_profile_id_rows,
    count(*) filter (where player_id is not null and invited_profile_id is not null) as both_recipient_fields,
    count(*) filter (where player_id is null and invited_profile_id is null) as neither_recipient_field
  from public.team_invites
),
column_rows as (
  select
    '02_COLUMN'::text as section,
    column_name::text as object_name,
    jsonb_build_object(
      'data_type', data_type,
      'nullable', is_nullable,
      'default', column_default
    ) as details
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'team_invites'
),
policy_rows as (
  select
    '03_POLICY'::text as section,
    policyname::text as object_name,
    jsonb_build_object(
      'command', cmd,
      'roles', roles,
      'using', qual,
      'with_check', with_check
    ) as details
  from pg_policies
  where schemaname = 'public'
    and tablename = 'team_invites'
),
view_rows as (
  select
    '04_VIEW'::text as section,
    viewname::text as object_name,
    jsonb_build_object(
      'definition', pg_get_viewdef(format('%I.%I', schemaname, viewname)::regclass, true)
    ) as details
  from pg_views
  where schemaname = 'public'
    and (
      viewname = 'team_invites_view'
      or pg_get_viewdef(format('%I.%I', schemaname, viewname)::regclass, true) ilike '%team_invites%'
    )
),
constraint_rows as (
  select
    '05_CONSTRAINT'::text as section,
    con.conname::text as object_name,
    jsonb_build_object(
      'definition', pg_get_constraintdef(con.oid, true)
    ) as details
  from pg_constraint con
  where con.conrelid = 'public.team_invites'::regclass
),
sample_rows as (
  select
    '06_SAMPLE'::text as section,
    id::text as object_name,
    jsonb_build_object(
      'status', status,
      'team_id', team_id,
      'player_id', player_id,
      'invited_profile_id', invited_profile_id,
      'invited_by_profile_id', invited_by_profile_id,
      'created_at', created_at
    ) as details
  from public.team_invites
  order by created_at desc nulls last
  limit 10
)
select
  '01_COUNTS'::text as section,
  'team_invites'::text as object_name,
  jsonb_build_object(
    'total_rows', total_rows,
    'pending_rows', pending_rows,
    'player_id_rows', player_id_rows,
    'invited_profile_id_rows', invited_profile_id_rows,
    'both_recipient_fields', both_recipient_fields,
    'neither_recipient_field', neither_recipient_field
  ) as details
from counts
union all
select * from column_rows
union all
select * from policy_rows
union all
select * from view_rows
union all
select * from constraint_rows
union all
select * from sample_rows
order by section, object_name;
