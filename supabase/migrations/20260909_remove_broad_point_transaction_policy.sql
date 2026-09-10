-- VCL 2.1 stabilization
-- Remove the broad ALL policy on player_point_transactions.
-- The existing command-specific admin policies already cover SELECT/INSERT/UPDATE/DELETE
-- and keep INSERT slightly stricter by requiring created_by = auth.uid().

begin;

drop policy if exists "Admins manage point transactions"
on public.player_point_transactions;

notify pgrst, 'reload schema';

commit;
