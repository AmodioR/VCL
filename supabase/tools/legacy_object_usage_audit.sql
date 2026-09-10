-- VCL 2.1 stabilization
-- READ ONLY
-- Purpose: inspect suspected legacy/public objects before removing anything.
-- Focus objects come from the 2026-09-09 schema/RLS audit.

with suspect_objects as (
  select unnest(array[
    'events',
    'player_placements',
    'player_stats',
    'roster_posts',
    'leaderboard_view'
  ]) as object_name
),
relation_inventory as (
  select
    c.oid,
    n.nspname as schema_name,
    c.relname as relation_name,
    c.relkind,
    c.reltuples::bigint as estimated_rows,
    pg_total_relation_size(c.oid) as total_bytes
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
),
rows_section as (
  select
    '01_OBJECT'::text as section,
    s.object_name,
    jsonb_build_object(
      'exists', r.oid is not null,
      'kind', case r.relkind
        when 'r' then 'table'
        when 'v' then 'view'
        when 'm' then 'materialized_view'
        when 'p' then 'partitioned_table'
        else r.relkind::text
      end,
      'estimated_rows', r.estimated_rows,
      'total_bytes', r.total_bytes
    ) as details
  from suspect_objects s
  left join relation_inventory r
    on r.relation_name = s.object_name
),
view_refs as (
  select
    '02_VIEW_REFERENCE'::text as section,
    v.schemaname || '.' || v.viewname as object_name,
    jsonb_build_object(
      'references', s.object_name,
      'definition', pg_get_viewdef(format('%I.%I', v.schemaname, v.viewname)::regclass, true)
    ) as details
  from pg_views v
  cross join suspect_objects s
  where v.schemaname = 'public'
    and pg_get_viewdef(format('%I.%I', v.schemaname, v.viewname)::regclass, true) ilike '%' || s.object_name || '%'
),
function_refs as (
  select
    '03_FUNCTION_REFERENCE'::text as section,
    n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object_name,
    jsonb_build_object(
      'references', s.object_name,
      'security_definer', p.prosecdef,
      'definition', pg_get_functiondef(p.oid)
    ) as details
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join suspect_objects s
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ilike '%' || s.object_name || '%'
),
fk_refs as (
  select
    '04_FK_REFERENCE'::text as section,
    con.conrelid::regclass::text || '.' || con.conname as object_name,
    jsonb_build_object(
      'references', s.object_name,
      'definition', pg_get_constraintdef(con.oid, true)
    ) as details
  from pg_constraint con
  join pg_class target on target.oid = con.confrelid
  join pg_namespace target_ns on target_ns.oid = target.relnamespace
  cross join suspect_objects s
  where con.contype = 'f'
    and target_ns.nspname = 'public'
    and target.relname = s.object_name
),
trigger_refs as (
  select
    '05_TRIGGER_REFERENCE'::text as section,
    n.nspname || '.' || c.relname || '.' || t.tgname as object_name,
    jsonb_build_object(
      'references', s.object_name,
      'definition', pg_get_triggerdef(t.oid, true)
    ) as details
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  cross join suspect_objects s
  where not t.tgisinternal
    and n.nspname = 'public'
    and (
      c.relname = s.object_name
      or pg_get_triggerdef(t.oid, true) ilike '%' || s.object_name || '%'
    )
),
policy_refs as (
  select
    '06_POLICY'::text as section,
    p.schemaname || '.' || p.tablename || '.' || p.policyname as object_name,
    jsonb_build_object(
      'object', p.tablename,
      'command', p.cmd,
      'roles', p.roles,
      'using', p.qual,
      'with_check', p.with_check
    ) as details
  from pg_policies p
  join suspect_objects s on s.object_name = p.tablename
  where p.schemaname = 'public'
)
select * from rows_section
union all
select * from view_refs
union all
select * from function_refs
union all
select * from fk_refs
union all
select * from trigger_refs
union all
select * from policy_refs
order by section, object_name;
