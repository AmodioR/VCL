-- VCL 2.1 — Captain-managed team logos
-- Allows the authenticated captain of a team to update only that team's logo_url.

create or replace function public.update_my_captain_team_logo(p_logo_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_player_id uuid;
  v_team public.teams%rowtype;
  v_logo_url text := trim(coalesce(p_logo_url, ''));
begin
  if v_user_id is null then
    raise exception 'Login required';
  end if;

  if v_logo_url = '' then
    raise exception 'Logo URL is required';
  end if;

  -- Only accept public URLs from VCL's existing team-logos Storage bucket.
  if position('/storage/v1/object/public/team-logos/' in v_logo_url) = 0 then
    raise exception 'Invalid team logo URL';
  end if;

  select p.id
    into v_player_id
  from public.players p
  where p.claimed_by_profile_id = v_user_id
  limit 1;

  if v_player_id is null then
    raise exception 'No claimed VCL player profile found';
  end if;

  update public.teams t
  set logo_url = v_logo_url
  where t.captain_player_id = v_player_id
  returning t.* into v_team;

  if not found then
    raise exception 'Captain access required';
  end if;

  return to_jsonb(v_team);
end;
$$;

revoke all on function public.update_my_captain_team_logo(text) from public;
revoke all on function public.update_my_captain_team_logo(text) from anon;
grant execute on function public.update_my_captain_team_logo(text) to authenticated;
