-- VCL Supabase RLS policy audit
-- READ ONLY: this query does not modify database objects.
--
-- Purpose:
--   Show every public/storage RLS policy and highlight likely duplicate policy
--   families so VCL can remove legacy overlap without deleting blindly.

with policies as (
  select
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check,
    md5(
      concat_ws(
        '|',
        schemaname,
        tablename,
        permissive,
        array_to_string(roles, ','),
        cmd,
        coalesce(qual, ''),
        coalesce(with_check, '')
      )
    ) as policy_signature
  from pg_policies
  where schemaname in ('public', 'storage')
),
exact_duplicates as (
  select
    policy_signature,
    count(*) as duplicate_count,
    array_agg(policyname order by policyname) as policy_names
  from policies
  group by policy_signature
  having count(*) > 1
),
table_summary as (
  select
    schemaname,
    tablename,
    count(*) as policy_count,
    count(*) filter (where cmd = 'SELECT') as select_count,
    count(*) filter (where cmd = 'INSERT') as insert_count,
    count(*) filter (where cmd = 'UPDATE') as update_count,
    count(*) filter (where cmd = 'DELETE') as delete_count,
    count(*) filter (where cmd = 'ALL') as all_count
  from policies
  group by schemaname, tablename
)
select
  '01_EXACT_DUPLICATE'::text as section,
  p.schemaname || '.' || p.tablename as object_name,
  jsonb_build_object(
    'duplicate_count', d.duplicate_count,
    'policy_names', to_jsonb(d.policy_names),
    'command', p.cmd,
    'roles', to_jsonb(p.roles),
    'permissive', p.permissive,
    'using', p.qual,
    'with_check', p.with_check
  ) as details
from exact_duplicates d
join policies p on p.policy_signature = d.policy_signature
where p.policyname = d.policy_names[1]

union all

select
  '02_POLICY'::text,
  p.schemaname || '.' || p.tablename || '.' || p.policyname,
  jsonb_build_object(
    'schema', p.schemaname,
    'table', p.tablename,
    'policy_name', p.policyname,
    'permissive', p.permissive,
    'roles', to_jsonb(p.roles),
    'command', p.cmd,
    'using', p.qual,
    'with_check', p.with_check,
    'exact_duplicate', exists (
      select 1
      from exact_duplicates d
      where d.policy_signature = p.policy_signature
    )
  )
from policies p

union all

select
  '03_TABLE_SUMMARY'::text,
  s.schemaname || '.' || s.tablename,
  jsonb_build_object(
    'policy_count', s.policy_count,
    'select_count', s.select_count,
    'insert_count', s.insert_count,
    'update_count', s.update_count,
    'delete_count', s.delete_count,
    'all_count', s.all_count
  )
from table_summary s

order by section, object_name;
