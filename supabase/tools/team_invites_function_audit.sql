-- VCL 2.1 stabilization
-- READ ONLY
-- Purpose: identify the live RPC/function paths that read or write team_invites
-- before choosing one canonical recipient model.

select
  '01_FUNCTION' as section,
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object_name,
  jsonb_build_object(
    'security_definer', p.prosecdef,
    'definition', pg_get_functiondef(p.oid)
  ) as details
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ilike '%team_invites%'
order by p.proname, pg_get_function_identity_arguments(p.oid);
