-- VCL Supabase security follow-up inventory
-- READ ONLY: this script does not modify the database.
--
-- Run when auditing view security, RPC EXECUTE permissions and auth/public triggers.

with inventory as (
  -- ----------------------------------------------------------
  -- VIEW SECURITY OPTIONS
  -- security_invoker=true is important for views that rely on base-table RLS.
  -- ----------------------------------------------------------
  select
    '01_VIEW_SECURITY'::text as section,
    c.relname::text as object_name,
    jsonb_build_object(
      'schema', n.nspname,
      'owner', pg_get_userbyid(c.relowner),
      'reloptions', to_jsonb(c.reloptions),
      'security_invoker', coalesce(c.reloptions @> array['security_invoker=true'], false),
      'security_barrier', coalesce(c.reloptions @> array['security_barrier=true'], false)
    ) as details
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'

  union all

  -- ----------------------------------------------------------
  -- FUNCTION / RPC EXECUTE GRANTS
  -- ----------------------------------------------------------
  select
    '02_ROUTINE_GRANT'::text,
    r.routine_name || '(' || coalesce(r.specific_name, '') || ').' || r.grantee,
    jsonb_build_object(
      'routine_schema', r.routine_schema,
      'routine_name', r.routine_name,
      'specific_name', r.specific_name,
      'grantee', r.grantee,
      'privilege', r.privilege_type,
      'grantable', r.is_grantable
    )
  from information_schema.role_routine_grants r
  where r.routine_schema = 'public'
    and r.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')

  union all

  -- ----------------------------------------------------------
  -- PUBLIC/AUTH TRIGGERS
  -- Includes auth.users hook such as handle_new_user if installed.
  -- ----------------------------------------------------------
  select
    '03_TRIGGER_SECURITY'::text,
    n.nspname || '.' || c.relname || '.' || t.tgname,
    jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname,
      'trigger', t.tgname,
      'enabled', t.tgenabled,
      'definition', pg_get_triggerdef(t.oid, true)
    )
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'auth')
    and not t.tgisinternal
)
select section, object_name, details
from inventory
order by section, object_name;
