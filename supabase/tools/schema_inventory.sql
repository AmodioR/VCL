-- VCL Supabase schema inventory
-- READ ONLY: this script does not create, update or delete anything.
--
-- Purpose:
--   Produce one exportable result set describing the live Supabase database layer.
--   Run this in Supabase -> SQL Editor, then export the result as CSV and keep it
--   as a debugging/reference snapshot.
--
-- The live database is the source of truth. Repository migrations may not fully
-- represent older functions, policies or objects that were created manually.

with inventory as (
  -- ----------------------------------------------------------
  -- TABLES
  -- ----------------------------------------------------------
  select
    '01_TABLE'::text as section,
    c.relname::text as object_name,
    jsonb_build_object(
      'schema', n.nspname,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'estimated_rows', greatest(c.reltuples::bigint, 0),
      'total_size', pg_size_pretty(pg_total_relation_size(c.oid))
    ) as details
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')

  union all

  -- ----------------------------------------------------------
  -- COLUMNS
  -- ----------------------------------------------------------
  select
    '02_COLUMN'::text,
    cols.table_name || '.' || cols.column_name,
    jsonb_build_object(
      'table', cols.table_name,
      'column', cols.column_name,
      'position', cols.ordinal_position,
      'data_type', cols.data_type,
      'udt_name', cols.udt_name,
      'nullable', cols.is_nullable,
      'default', cols.column_default,
      'identity', cols.is_identity,
      'generated', cols.is_generated
    )
  from information_schema.columns cols
  where cols.table_schema = 'public'

  union all

  -- ----------------------------------------------------------
  -- CONSTRAINTS: PK / FK / UNIQUE / CHECK / EXCLUSION
  -- ----------------------------------------------------------
  select
    '03_CONSTRAINT'::text,
    cls.relname || '.' || con.conname,
    jsonb_build_object(
      'table', cls.relname,
      'constraint_name', con.conname,
      'constraint_type', case con.contype
        when 'p' then 'PRIMARY KEY'
        when 'f' then 'FOREIGN KEY'
        when 'u' then 'UNIQUE'
        when 'c' then 'CHECK'
        when 'x' then 'EXCLUSION'
        else con.contype::text
      end,
      'definition', pg_get_constraintdef(con.oid, true),
      'validated', con.convalidated
    )
  from pg_constraint con
  join pg_class cls on cls.oid = con.conrelid
  join pg_namespace n on n.oid = cls.relnamespace
  where n.nspname = 'public'

  union all

  -- ----------------------------------------------------------
  -- INDEXES
  -- ----------------------------------------------------------
  select
    '04_INDEX'::text,
    idx.tablename || '.' || idx.indexname,
    jsonb_build_object(
      'table', idx.tablename,
      'index_name', idx.indexname,
      'definition', idx.indexdef
    )
  from pg_indexes idx
  where idx.schemaname = 'public'

  union all

  -- ----------------------------------------------------------
  -- RLS POLICIES (public + storage)
  -- ----------------------------------------------------------
  select
    '05_POLICY'::text,
    pol.schemaname || '.' || pol.tablename || '.' || pol.policyname,
    jsonb_build_object(
      'schema', pol.schemaname,
      'table', pol.tablename,
      'policy_name', pol.policyname,
      'permissive', pol.permissive,
      'roles', to_jsonb(pol.roles),
      'command', pol.cmd,
      'using', pol.qual,
      'with_check', pol.with_check
    )
  from pg_policies pol
  where pol.schemaname in ('public', 'storage')

  union all

  -- ----------------------------------------------------------
  -- TRIGGERS
  -- ----------------------------------------------------------
  select
    '06_TRIGGER'::text,
    cls.relname || '.' || trg.tgname,
    jsonb_build_object(
      'table', cls.relname,
      'trigger_name', trg.tgname,
      'definition', pg_get_triggerdef(trg.oid, true),
      'enabled', trg.tgenabled
    )
  from pg_trigger trg
  join pg_class cls on cls.oid = trg.tgrelid
  join pg_namespace n on n.oid = cls.relnamespace
  where n.nspname = 'public'
    and not trg.tgisinternal

  union all

  -- ----------------------------------------------------------
  -- FUNCTIONS / RPCs
  -- ----------------------------------------------------------
  select
    '07_FUNCTION'::text,
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    jsonb_build_object(
      'function_name', p.proname,
      'arguments', pg_get_function_identity_arguments(p.oid),
      'result', pg_get_function_result(p.oid),
      'language', lang.lanname,
      'security_definer', p.prosecdef,
      'volatility', case p.provolatile
        when 'i' then 'immutable'
        when 's' then 'stable'
        when 'v' then 'volatile'
        else p.provolatile::text
      end,
      'definition', pg_get_functiondef(p.oid)
    )
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language lang on lang.oid = p.prolang
  where n.nspname = 'public'
    and p.prokind = 'f'

  union all

  -- ----------------------------------------------------------
  -- VIEWS
  -- ----------------------------------------------------------
  select
    '08_VIEW'::text,
    v.viewname,
    jsonb_build_object(
      'view_name', v.viewname,
      'owner', v.viewowner,
      'definition', v.definition
    )
  from pg_views v
  where v.schemaname = 'public'

  union all

  -- ----------------------------------------------------------
  -- MATERIALIZED VIEWS
  -- ----------------------------------------------------------
  select
    '09_MATERIALIZED_VIEW'::text,
    mv.matviewname,
    jsonb_build_object(
      'view_name', mv.matviewname,
      'owner', mv.matviewowner,
      'definition', mv.definition
    )
  from pg_matviews mv
  where mv.schemaname = 'public'

  union all

  -- ----------------------------------------------------------
  -- ENUM TYPES
  -- ----------------------------------------------------------
  select
    '10_ENUM'::text,
    t.typname,
    jsonb_build_object(
      'enum_name', t.typname,
      'values', (
        select jsonb_agg(e.enumlabel order by e.enumsortorder)
        from pg_enum e
        where e.enumtypid = t.oid
      )
    )
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typtype = 'e'

  union all

  -- ----------------------------------------------------------
  -- TABLE GRANTS USED BY SUPABASE CLIENT ROLES
  -- ----------------------------------------------------------
  select
    '11_GRANT'::text,
    g.table_name || '.' || g.grantee || '.' || g.privilege_type,
    jsonb_build_object(
      'table', g.table_name,
      'grantee', g.grantee,
      'privilege', g.privilege_type,
      'grantable', g.is_grantable
    )
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.grantee in ('anon', 'authenticated', 'service_role')

  union all

  -- ----------------------------------------------------------
  -- STORAGE BUCKETS
  -- ----------------------------------------------------------
  select
    '12_STORAGE_BUCKET'::text,
    b.id::text,
    jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'public', b.public,
      'file_size_limit', b.file_size_limit,
      'allowed_mime_types', to_jsonb(b.allowed_mime_types)
    )
  from storage.buckets b
)
select
  section,
  object_name,
  details
from inventory
order by section, object_name;
