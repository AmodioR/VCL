-- VCL 2.1 — Moderated player avatars
-- Flow: player uploads a compressed pending image -> admin approves/rejects -> only approved image becomes public.

alter table public.players
  add column if not exists avatar_url text,
  add column if not exists avatar_storage_path text,
  add column if not exists avatar_updated_at timestamptz;

-- Prevent clients from bypassing moderation by updating avatar columns directly.
-- Security-definer RPCs execute the approved changes as the database owner.
create or replace function public.guard_player_avatar_moderation()
returns trigger
language plpgsql
as $$
begin
  if new.avatar_url is distinct from old.avatar_url
     or new.avatar_storage_path is distinct from old.avatar_storage_path then
    if current_user not in ('postgres', 'supabase_admin', 'service_role')
       and not exists (
         select 1 from public.profiles p
         where p.id = auth.uid() and p.role = 'admin'
       ) then
      raise exception 'Player avatar changes require moderation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_player_avatar_moderation_trigger on public.players;
create trigger guard_player_avatar_moderation_trigger
before update of avatar_url, avatar_storage_path on public.players
for each row execute function public.guard_player_avatar_moderation();

create table if not exists public.player_avatar_submissions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  submitted_by_profile_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','replaced')),
  reject_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null
);

create unique index if not exists player_avatar_submissions_one_pending_per_player
  on public.player_avatar_submissions(player_id)
  where status = 'pending';

create index if not exists player_avatar_submissions_status_created_idx
  on public.player_avatar_submissions(status, created_at desc);

alter table public.player_avatar_submissions enable row level security;
revoke all on public.player_avatar_submissions from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-avatar-pending',
  'player-avatar-pending',
  false,
  600000,
  array['image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-avatars',
  'player-avatars',
  true,
  600000,
  array['image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Pending files: the uploader can manage only their own folder; admins can review all pending files.
drop policy if exists "VCL avatar pending upload own" on storage.objects;
create policy "VCL avatar pending upload own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'player-avatar-pending'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "VCL avatar pending read own or admin" on storage.objects;
create policy "VCL avatar pending read own or admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'player-avatar-pending'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
);

drop policy if exists "VCL avatar pending delete own or admin" on storage.objects;
create policy "VCL avatar pending delete own or admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'player-avatar-pending'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
);

-- Approved/public bucket: only admins may write/delete. Public read is provided by the public bucket itself.
drop policy if exists "VCL avatar approved admin upload" on storage.objects;
create policy "VCL avatar approved admin upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'player-avatars'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "VCL avatar approved admin delete" on storage.objects;
create policy "VCL avatar approved admin delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'player-avatars'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

drop policy if exists "VCL avatar approved owner delete" on storage.objects;
create policy "VCL avatar approved owner delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'player-avatars'
  and exists (
    select 1
    from public.players p
    where p.claimed_by_profile_id = auth.uid()
      and p.id::text = (storage.foldername(name))[1]
  )
);

create or replace function public.submit_my_player_avatar(p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_player_id uuid;
  v_previous_path text;
  v_submission public.player_avatar_submissions%rowtype;
begin
  if v_user_id is null then
    raise exception 'Login required';
  end if;

  if trim(coalesce(p_storage_path, '')) = ''
     or p_storage_path not like v_user_id::text || '/%'
     or lower(p_storage_path) not like '%.webp' then
    raise exception 'Invalid avatar storage path';
  end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'player-avatar-pending'
      and o.name = p_storage_path
  ) then
    raise exception 'Pending avatar file was not found';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.claimed_by_profile_id = v_user_id
  limit 1;

  if v_player_id is null then
    raise exception 'No claimed VCL player profile found';
  end if;

  select s.storage_path into v_previous_path
  from public.player_avatar_submissions s
  where s.player_id = v_player_id and s.status = 'pending'
  order by s.created_at desc
  limit 1;

  update public.player_avatar_submissions
  set status = 'replaced', reviewed_at = now(), reject_reason = 'Replaced by newer upload'
  where player_id = v_player_id and status = 'pending';

  insert into public.player_avatar_submissions (
    player_id,
    submitted_by_profile_id,
    storage_path
  ) values (
    v_player_id,
    v_user_id,
    p_storage_path
  )
  returning * into v_submission;

  return jsonb_build_object(
    'id', v_submission.id,
    'player_id', v_player_id,
    'status', v_submission.status,
    'storage_path', v_submission.storage_path,
    'previous_pending_storage_path', v_previous_path
  );
end;
$$;

create or replace function public.get_my_player_avatar_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_player public.players%rowtype;
  v_submission public.player_avatar_submissions%rowtype;
begin
  if v_user_id is null then
    return null;
  end if;

  select p.* into v_player
  from public.players p
  where p.claimed_by_profile_id = v_user_id
  limit 1;

  if v_player.id is null then
    return null;
  end if;

  select s.* into v_submission
  from public.player_avatar_submissions s
  where s.player_id = v_player.id
  order by s.created_at desc
  limit 1;

  return jsonb_build_object(
    'player_id', v_player.id,
    'player_slug', v_player.slug,
    'alias', v_player.alias,
    'avatar_url', v_player.avatar_url,
    'avatar_storage_path', v_player.avatar_storage_path,
    'submission_id', v_submission.id,
    'submission_status', v_submission.status,
    'pending_storage_path', case when v_submission.status = 'pending' then v_submission.storage_path else null end,
    'reject_reason', v_submission.reject_reason,
    'submitted_at', v_submission.created_at,
    'reviewed_at', v_submission.reviewed_at
  );
end;
$$;

create or replace function public.remove_my_player_avatar()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_player_id uuid;
  v_previous_storage_path text;
begin
  if v_user_id is null then
    raise exception 'Login required';
  end if;

  select p.id, p.avatar_storage_path
    into v_player_id, v_previous_storage_path
  from public.players p
  where p.claimed_by_profile_id = v_user_id
  limit 1;

  if v_player_id is null then
    raise exception 'No claimed VCL player profile found';
  end if;

  update public.players
  set avatar_url = null,
      avatar_storage_path = null,
      avatar_updated_at = now()
  where id = v_player_id;

  return jsonb_build_object(
    'player_id', v_player_id,
    'previous_storage_path', v_previous_storage_path
  );
end;
$$;

create or replace function public.admin_get_pending_player_avatars()
returns table (
  submission_id uuid,
  player_id uuid,
  player_slug text,
  alias text,
  current_avatar_url text,
  pending_storage_path text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Admin access required';
  end if;

  return query
  select
    s.id,
    p.id,
    p.slug,
    p.alias,
    p.avatar_url,
    s.storage_path,
    s.created_at
  from public.player_avatar_submissions s
  join public.players p on p.id = s.player_id
  where s.status = 'pending'
  order by s.created_at asc;
end;
$$;

create or replace function public.admin_review_player_avatar(
  p_submission_id uuid,
  p_decision text,
  p_approved_avatar_url text default null,
  p_approved_storage_path text default null,
  p_reject_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_submission public.player_avatar_submissions%rowtype;
  v_player public.players%rowtype;
  v_previous_avatar_path text;
  v_decision text := lower(trim(coalesce(p_decision, '')));
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = v_admin_id and p.role = 'admin'
  ) then
    raise exception 'Admin access required';
  end if;

  select s.* into v_submission
  from public.player_avatar_submissions s
  where s.id = p_submission_id and s.status = 'pending'
  for update;

  if v_submission.id is null then
    raise exception 'Avatar submission is no longer pending';
  end if;

  select p.* into v_player
  from public.players p
  where p.id = v_submission.player_id
  for update;

  if v_decision = 'approve' then
    if trim(coalesce(p_approved_avatar_url, '')) = ''
       or position('/storage/v1/object/public/player-avatars/' in p_approved_avatar_url) = 0
       or trim(coalesce(p_approved_storage_path, '')) = '' then
      raise exception 'Approved avatar URL/path is required';
    end if;

    v_previous_avatar_path := v_player.avatar_storage_path;

    update public.players
    set avatar_url = p_approved_avatar_url,
        avatar_storage_path = p_approved_storage_path,
        avatar_updated_at = now()
    where id = v_submission.player_id;

    update public.player_avatar_submissions
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by_profile_id = v_admin_id,
        reject_reason = null
    where id = v_submission.id;

  elsif v_decision = 'reject' then
    update public.player_avatar_submissions
    set status = 'rejected',
        reviewed_at = now(),
        reviewed_by_profile_id = v_admin_id,
        reject_reason = nullif(trim(coalesce(p_reject_reason, '')), '')
    where id = v_submission.id;
  else
    raise exception 'Decision must be approve or reject';
  end if;

  return jsonb_build_object(
    'submission_id', v_submission.id,
    'player_id', v_submission.player_id,
    'player_slug', v_player.slug,
    'alias', v_player.alias,
    'decision', v_decision,
    'pending_storage_path', v_submission.storage_path,
    'previous_avatar_storage_path', v_previous_avatar_path
  );
end;
$$;

revoke all on function public.submit_my_player_avatar(text) from public, anon;
grant execute on function public.submit_my_player_avatar(text) to authenticated;

revoke all on function public.get_my_player_avatar_status() from public, anon;
grant execute on function public.get_my_player_avatar_status() to authenticated;

revoke all on function public.remove_my_player_avatar() from public, anon;
grant execute on function public.remove_my_player_avatar() to authenticated;

revoke all on function public.admin_get_pending_player_avatars() from public, anon;
grant execute on function public.admin_get_pending_player_avatars() to authenticated;

revoke all on function public.admin_review_player_avatar(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_review_player_avatar(uuid, text, text, text, text) to authenticated;
