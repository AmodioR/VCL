-- VCL 2.1 stabilization
-- Prevent authenticated users from changing their own profile role.
--
-- The live schema had two self-update policies on public.profiles. One included
-- `role = role`, which is a tautology and does not protect the role column.
-- Keep normal self-profile editing, but enforce role changes at the DB trigger
-- layer so a regular user cannot promote themselves to admin.

begin;

-- Remove the older misleading compatibility policy. The canonical
-- `profiles_update_own` policy remains for normal own-row edits.
drop policy if exists "Users can update own profile"
on public.profiles;

create or replace function public.guard_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    -- If a user edits their own profile, their *existing* role must already be
    -- admin. This prevents changing user -> admin in the same statement.
    if auth.uid() = old.id then
      if coalesce(old.role, '') <> 'admin' then
        raise exception 'Kun admins kan ændre profilroller.';
      end if;
    else
      -- Admins may still manage another profile's role through admin tooling.
      if not exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
      ) then
        raise exception 'Kun admins kan ændre profilroller.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_role_change_trigger
on public.profiles;

create trigger guard_profile_role_change_trigger
before update of role on public.profiles
for each row
execute function public.guard_profile_role_change();

-- Trigger helpers are not browser RPCs.
revoke all on function public.guard_profile_role_change() from public;
revoke all on function public.guard_profile_role_change() from anon;
revoke all on function public.guard_profile_role_change() from authenticated;

notify pgrst, 'reload schema';

commit;
