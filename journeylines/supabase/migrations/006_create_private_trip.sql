begin;

-- GlobeHoppers v8.2 Work Package 3
-- Create a complete private trip in one authenticated transaction.

create or replace function public.create_private_trip(
  p_map_id uuid,
  p_trip jsonb,
  p_locations jsonb,
  p_legs jsonb,
  p_hopper_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_trip_id uuid;
  location_item jsonb;
  leg_item jsonb;
  client_location_map jsonb := '{}'::jsonb;
  resolved_location_id uuid;
  from_location_id uuid;
  to_location_id uuid;
  hopper_id uuid;
  requested_hopper_count integer;
  valid_hopper_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_map_id is null or not private.can_edit_map(p_map_id) then
    raise exception 'You do not have permission to edit this travel map.' using errcode = '42501';
  end if;

  if p_trip is null or nullif(trim(p_trip->>'title'), '') is null then
    raise exception 'A trip title is required.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_locations, '[]'::jsonb)) <> 'array' then
    raise exception 'Locations must be provided as an array.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_legs, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_legs, '[]'::jsonb)) < 1 then
    raise exception 'At least one trip leg is required.' using errcode = '22023';
  end if;

  requested_hopper_count := coalesce(array_length(p_hopper_ids, 1), 0);
  if requested_hopper_count > 0 then
    select count(*)
      into valid_hopper_count
      from public.hoppers h
     where h.id = any(p_hopper_ids)
       and h.map_id = p_map_id;

    if valid_hopper_count <> requested_hopper_count then
      raise exception 'Every selected Hopper must belong to the current travel map.' using errcode = '23514';
    end if;
  end if;

  -- Resolve each client-side location ID to a database UUID. Reuse an exact
  -- coordinate/name match when possible so repeated trips do not duplicate cities.
  for location_item in select value from jsonb_array_elements(coalesce(p_locations, '[]'::jsonb))
  loop
    if nullif(trim(location_item->>'client_id'), '') is null then
      raise exception 'Every location needs a client ID.' using errcode = '22023';
    end if;

    if nullif(trim(location_item->>'name'), '') is null then
      raise exception 'Every location needs a name.' using errcode = '22023';
    end if;

    if (location_item->>'latitude') is null or (location_item->>'longitude') is null then
      raise exception 'Every location needs latitude and longitude.' using errcode = '22023';
    end if;

    resolved_location_id := null;

    begin
      if (location_item->>'client_id')::uuid is not null then
        select l.id into resolved_location_id
          from public.locations l
         where l.id = (location_item->>'client_id')::uuid;
      end if;
    exception when invalid_text_representation then
      resolved_location_id := null;
    end;

    if resolved_location_id is null then
      select l.id into resolved_location_id
        from public.locations l
       where lower(trim(l.name)) = lower(trim(location_item->>'name'))
         and abs(l.latitude - (location_item->>'latitude')::double precision) < 0.000001
         and abs(l.longitude - (location_item->>'longitude')::double precision) < 0.000001
       order by l.created_at
       limit 1;
    end if;

    if resolved_location_id is null then
      insert into public.locations (
        name,
        region,
        country,
        continent,
        latitude,
        longitude
      ) values (
        trim(location_item->>'name'),
        nullif(trim(location_item->>'region'), ''),
        nullif(trim(location_item->>'country'), ''),
        nullif(trim(location_item->>'continent'), ''),
        (location_item->>'latitude')::double precision,
        (location_item->>'longitude')::double precision
      )
      returning id into resolved_location_id;
    end if;

    client_location_map := client_location_map || jsonb_build_object(location_item->>'client_id', resolved_location_id::text);
  end loop;

  insert into public.trips (
    map_id,
    title,
    start_date,
    end_date,
    notes,
    sort_order,
    occasion,
    trail_style,
    trail_color_mode
  ) values (
    p_map_id,
    trim(p_trip->>'title'),
    nullif(p_trip->>'start_date', '')::date,
    nullif(p_trip->>'end_date', '')::date,
    nullif(p_trip->>'notes', ''),
    greatest(coalesce((p_trip->>'sort_order')::integer, 0), 0),
    nullif(p_trip->>'occasion', ''),
    coalesce(nullif(p_trip->>'trail_style', ''), 'solid'),
    coalesce(nullif(p_trip->>'trail_color_mode', ''), 'members')
  )
  returning id into created_trip_id;

  for leg_item in select value from jsonb_array_elements(p_legs)
  loop
    from_location_id := nullif(client_location_map->>(leg_item->>'from_client_id'), '')::uuid;
    to_location_id := nullif(client_location_map->>(leg_item->>'to_client_id'), '')::uuid;

    if from_location_id is null or to_location_id is null then
      raise exception 'A trip leg references an unresolved location.' using errcode = '23503';
    end if;

    insert into public.trip_legs (
      trip_id,
      from_location_id,
      to_location_id,
      transport_mode,
      leg_order,
      departure_date,
      arrival_date,
      route_label,
      notes,
      route_geometry,
      route_provider,
      route_version
    ) values (
      created_trip_id,
      from_location_id,
      to_location_id,
      coalesce(nullif(leg_item->>'transport_mode', ''), 'flight'),
      (leg_item->>'leg_order')::integer,
      nullif(leg_item->>'departure_date', '')::date,
      nullif(leg_item->>'arrival_date', '')::date,
      nullif(leg_item->>'route_label', ''),
      nullif(leg_item->>'notes', ''),
      case when leg_item ? 'route_geometry' then leg_item->'route_geometry' else null end,
      nullif(leg_item->>'route_provider', ''),
      nullif(leg_item->>'route_version', '')
    );
  end loop;

  foreach hopper_id in array coalesce(p_hopper_ids, array[]::uuid[])
  loop
    insert into public.trip_hoppers (trip_id, hopper_id)
    values (created_trip_id, hopper_id);
  end loop;

  return created_trip_id;
end;
$$;

revoke all on function public.create_private_trip(uuid, jsonb, jsonb, jsonb, uuid[]) from public;
revoke all on function public.create_private_trip(uuid, jsonb, jsonb, jsonb, uuid[]) from anon;
grant execute on function public.create_private_trip(uuid, jsonb, jsonb, jsonb, uuid[]) to authenticated;

comment on function public.create_private_trip(uuid, jsonb, jsonb, jsonb, uuid[]) is
  'Creates one private GlobeHoppers trip, its locations, ordered legs, and Hopper assignments atomically for the authenticated map editor.';

commit;
