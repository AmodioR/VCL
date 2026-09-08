-- VCL homepage latest result — generic tournament choices
-- Extends the manual homepage result so admins can choose either a concrete
-- tournament row or a generic VCL category such as Academy, Contender,
-- Championship or DM.

alter table public.home_featured_results
  add column if not exists tournament_key text,
  add column if not exists tournament_name text,
  add column if not exists tournament_url text;

alter table public.home_featured_results
  alter column tournament_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'home_featured_results_tournament_source_check'
      and conrelid = 'public.home_featured_results'::regclass
  ) then
    alter table public.home_featured_results
      add constraint home_featured_results_tournament_source_check
      check (
        tournament_id is not null
        or (
          nullif(trim(coalesce(tournament_name, '')), '') is not null
          and nullif(trim(coalesce(tournament_url, '')), '') is not null
        )
      );
  end if;
end
$$;

create or replace view public.public_home_latest_result_view
with (security_invoker = true)
as
select
  r.id,
  r.tournament_id,
  r.tournament_key,
  coalesce(t.name, nullif(trim(r.tournament_name), ''), 'VCL Turnering') as tournament_name,
  t.slug as tournament_slug,
  coalesce(t.series_slug, r.tournament_key) as series_slug,
  coalesce(
    case
      when t.id is not null then 'turnering.html?tournament=' || t.slug
      else null
    end,
    nullif(trim(r.tournament_url), ''),
    'turneringer.html'
  ) as tournament_url,
  r.round_label,
  r.team_a_id,
  ta.name as team_a_name,
  ta.slug as team_a_slug,
  ta.logo_url as team_a_logo_url,
  r.team_a_score,
  r.team_b_id,
  tb.name as team_b_name,
  tb.slug as team_b_slug,
  tb.logo_url as team_b_logo_url,
  r.team_b_score,
  r.summary,
  r.created_at,
  r.updated_at
from public.home_featured_results r
left join public.tournaments t on t.id = r.tournament_id
join public.teams ta on ta.id = r.team_a_id
join public.teams tb on tb.id = r.team_b_id
where r.is_active = true;

grant select on public.public_home_latest_result_view to anon, authenticated;

create or replace function public.admin_set_home_latest_result_v2(
  p_tournament_id uuid,
  p_tournament_key text,
  p_tournament_name text,
  p_tournament_url text,
  p_team_a_id uuid,
  p_team_a_score integer,
  p_team_b_id uuid,
  p_team_b_score integer,
  p_round_label text default 'Grand Final',
  p_summary text default ''
)
returns public.home_featured_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.home_featured_results;
  v_tournament_name text := nullif(trim(coalesce(p_tournament_name, '')), '');
  v_tournament_url text := nullif(trim(coalesce(p_tournament_url, '')), '');
begin
  if not public.is_vcl_admin() then
    raise exception 'Kun admins kan opdatere forsidens resultat.';
  end if;

  if p_tournament_id is null and (v_tournament_name is null or v_tournament_url is null) then
    raise exception 'Vælg en turnering eller VCL-kategori.';
  end if;

  if p_tournament_id is not null and not exists (
    select 1 from public.tournaments where id = p_tournament_id
  ) then
    raise exception 'Den valgte turnering findes ikke.';
  end if;

  if p_team_a_id is null or p_team_b_id is null then
    raise exception 'Vælg begge hold.';
  end if;

  if p_team_a_id = p_team_b_id then
    raise exception 'Vælg to forskellige hold.';
  end if;

  if coalesce(p_team_a_score, -1) < 0 or coalesce(p_team_b_score, -1) < 0 then
    raise exception 'Scores skal være 0 eller højere.';
  end if;

  update public.home_featured_results
  set is_active = false,
      updated_at = now()
  where is_active = true;

  insert into public.home_featured_results (
    tournament_id,
    tournament_key,
    tournament_name,
    tournament_url,
    team_a_id,
    team_a_score,
    team_b_id,
    team_b_score,
    round_label,
    summary,
    is_active,
    created_by
  )
  values (
    p_tournament_id,
    case when p_tournament_id is null then nullif(trim(coalesce(p_tournament_key, '')), '') else null end,
    case when p_tournament_id is null then v_tournament_name else null end,
    case when p_tournament_id is null then v_tournament_url else null end,
    p_team_a_id,
    p_team_a_score,
    p_team_b_id,
    p_team_b_score,
    coalesce(nullif(trim(p_round_label), ''), 'Grand Final'),
    coalesce(trim(p_summary), ''),
    true,
    auth.uid()
  )
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_set_home_latest_result_v2(
  uuid, text, text, text, uuid, integer, uuid, integer, text, text
) to authenticated;
