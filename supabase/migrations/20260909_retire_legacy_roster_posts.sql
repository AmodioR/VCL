-- VCL 2.1 stabilization
-- Retire legacy roster_posts after live audit confirmed:
-- - zero rows
-- - no frontend references
-- - no dependent views/functions/FKs
-- - only its own trigger/policy remain

begin;

-- Deliberately no CASCADE: if any dependency still exists in live Supabase,
-- PostgreSQL will stop here instead of removing unrelated objects.
drop table if exists public.roster_posts;

notify pgrst, 'reload schema';

commit;
