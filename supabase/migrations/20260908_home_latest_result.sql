-- VCL homepage latest result
-- Manual admin-controlled result shown on the homepage.

create table if not exists public.home_featured_results (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  team_a_id uuid not null references public.teams(id) on delete restrict,
  team_b_id uuid not null references public.teams(id) on delete restrict,
  team_a_score integer not null check (team_a_score >= 0),
  team_b_score integer not null check (team_b_score >= 0),
  round_label text not null default 'Grand Final',
  summary text not null default '',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_featured_results_distinct_teams check (team_a_id <> team_b_id)
);

create unique index if not exists home_featured_results_one_active_idx
  on public.home_featured_results ((is_active))
  where is_active = true;

alter table public.home_featured_results enable row level security;

drop policy if exists "Public can read active home result" on public.home_featured_results;
create policy "Public can read active home result"
on public.home_featured_results for select
to anon, authenticated
using (is_active = true or public.is_vcl_admin());

drop policy if exists "Admins manage home result" on public.home_featured_results;
create policy "Admins manage home result"
on public.home_featured_results for all
to authenticated
using (public.is_vcl_admin())
with check (public.is_vcl_admin());

drop trigger if exists home_featured_results_set_updated_at on public.home_featured_results;
create trigger home_featured_results_set_updated_at
before update on public.home_featured_results
for each row execute function public.vcl_set_updated_at();

create or replace view public.public_home_latest_result_view
with (security_invoker = true)
as
select
  r.id,
  r.tournament_id,
  t.name as tournament_name,
  t.slug as tournament_slug,
  t.series_slug,
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
join public.tournaments t on t.id = r.tournament_id
join public.teams ta on ta.id = r.team_a_id
join public.teams tb on tb.id = r.team_b_id
where r.is_active = true;

grant select on public.public_home_latest_result_view to anon, authenticated;
grant select, insert, update, delete on public.home_featured_results to authenticated;

create or replace function public.admin_set_home_latest_result(
  p_tournament_id uuid,
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
begin
  if not public.is_vcl_admin() then
    raise exception 'Kun admins kan opdatere forsidens resultat.';
  end if;

  if p_tournament_id is null then
    raise exception 'Vælg en turnering.';
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

create or replace function public.admin_clear_home_latest_result()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_vcl_admin() then
    raise exception 'Kun admins kan fjerne forsidens resultat.';
  end if;

  update public.home_featured_results
  set is_active = false,
      updated_at = now()
  where is_active = true;

  return true;
end;
$$;

grant execute on function public.admin_set_home_latest_result(uuid, uuid, integer, uuid, integer, text, text) to authenticated;
grant execute on function public.admin_clear_home_latest_result() to authenticated;
