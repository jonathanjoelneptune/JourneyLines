begin;

-- Securely creates or returns the authenticated user's first travel map.
-- The browser never supplies an owner UUID; ownership comes from auth.uid().
create or replace function public.ensure_default_travel_map()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_map_id uuid;
  profile_name text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;

  insert into public.profiles (id, display_name)
  select
    au.id,
    coalesce(
      nullif(au.raw_user_meta_data ->> 'display_name', ''),
      nullif(au.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(au.email, ''), '@', 1),
      'GlobeHopper'
    )
  from auth.users au
  where au.id = current_user_id
  on conflict (id) do nothing;

  select up.default_map_id
  into current_map_id
  from public.user_preferences up
  where up.user_id = current_user_id
    and up.default_map_id is not null;

  if current_map_id is not null and exists (
    select 1
    from public.travel_maps tm
    where tm.id = current_map_id
      and (
        tm.owner_id = current_user_id
        or exists (
          select 1 from public.map_members mm
          where mm.map_id = tm.id and mm.user_id = current_user_id
        )
      )
  ) then
    return current_map_id;
  end if;

  select tm.id
  into current_map_id
  from public.travel_maps tm
  where tm.owner_id = current_user_id
  order by tm.created_at asc
  limit 1;

  if current_map_id is null then
    select coalesce(nullif(trim(p.display_name), ''), 'My')
    into profile_name
    from public.profiles p
    where p.id = current_user_id;

    insert into public.travel_maps (owner_id, name, description, is_public)
    values (
      current_user_id,
      case when profile_name = 'My' then 'My Globe' else profile_name || '''s Globe' end,
      'Private GlobeHoppers travel map',
      false
    )
    returning id into current_map_id;
  end if;

  insert into public.map_members (map_id, user_id, role)
  values (current_map_id, current_user_id, 'owner')
  on conflict (map_id, user_id)
  do update set role = 'owner';

  insert into public.user_preferences (user_id, default_map_id)
  values (current_user_id, current_map_id)
  on conflict (user_id)
  do update set default_map_id = excluded.default_map_id;

  return current_map_id;
end;
$$;

revoke all on function public.ensure_default_travel_map() from public;
grant execute on function public.ensure_default_travel_map() to authenticated;

comment on function public.ensure_default_travel_map() is
  'Returns the current authenticated user''s default map, creating a private owner map when needed.';

commit;
