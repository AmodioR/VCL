-- VCL team registration: descriptions are optional.
-- Keep existing descriptions, but make omitted values resolve to an empty string.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'team_signups'
      and column_name = 'team_description'
  ) then
    update public.team_signups
    set team_description = ''
    where team_description is null;

    alter table public.team_signups
      alter column team_description set default '';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'teams'
      and column_name = 'description'
  ) then
    update public.teams
    set description = ''
    where description is null;

    alter table public.teams
      alter column description set default '';
  end if;
end
$$;
