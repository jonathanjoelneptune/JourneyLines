-- GlobeHoppers v8.2.8 Work Package 6
-- Account-specific timeline ordering with optimistic concurrency protection.

alter table public.travel_maps
  add column if not exists timeline_order_revision bigint not null default 0;

-- Establish one deterministic complete order per map before cloud reordering is enabled.
with ranked as (
  select
    id,
    row_number() over (
      partition by map_id
      order by start_date nulls last, sort_order nulls last, created_at, id
    ) - 1 as next_order
  from public.trips
)
update public.trips t
set sort_order = ranked.next_order
from ranked
where ranked.id = t.id
  and t.sort_order is distinct from ranked.next_order;

create or replace function private.assign_trip_sort_order()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth
as $$
begin
  if new.sort_order is null or new.sort_order < 0
     or (new.sort_order = 0 and exists (select 1 from public.trips t where t.map_id = new.map_id)) then
    select coalesce(max(t.sort_order), -1) + 1
      into new.sort_order
      from public.trips t
     where t.map_id = new.map_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_trip_sort_order on public.trips;
create trigger trg_assign_trip_sort_order
before insert on public.trips
for each row execute function private.assign_trip_sort_order();

create or replace function public.reorder_private_trips(
  p_map_id uuid,
  p_expected_revision bigint,
  p_trip_ids uuid[]
)
returns bigint
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_current_revision bigint;
  v_expected_count integer;
  v_supplied_count integer;
  v_distinct_count integer;
  v_matched_count integer;
  v_next_revision bigint;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to reorder this timeline.';
  end if;

  if p_map_id is null or not private.can_edit_map(p_map_id) then
    raise exception 'You do not have permission to reorder this timeline.';
  end if;

  select timeline_order_revision
    into v_current_revision
    from public.travel_maps
   where id = p_map_id;

  if not found then
    raise exception 'The selected travel map could not be found.';
  end if;

  if coalesce(p_expected_revision, -1) <> v_current_revision then
    raise exception 'This timeline changed in another session. Reload before saving the order.';
  end if;

  select count(*) into v_expected_count
    from public.trips
   where map_id = p_map_id;

  v_supplied_count := coalesce(array_length(p_trip_ids, 1), 0);
  select count(distinct trip_id) into v_distinct_count
    from unnest(coalesce(p_trip_ids, array[]::uuid[])) as supplied(trip_id);
  select count(*) into v_matched_count
    from public.trips
   where map_id = p_map_id
     and id = any(coalesce(p_trip_ids, array[]::uuid[]));

  if v_supplied_count <> v_expected_count
     or v_distinct_count <> v_supplied_count
     or v_matched_count <> v_expected_count then
    raise exception 'The timeline order is incomplete or contains trips from another map. Reload and try again.';
  end if;

  update public.trips t
     set sort_order = ordered.ordinality - 1,
         updated_at = case
           when t.sort_order is distinct from ordered.ordinality - 1 then now()
           else t.updated_at
         end
    from unnest(p_trip_ids) with ordinality as ordered(trip_id, ordinality)
   where t.id = ordered.trip_id
     and t.map_id = p_map_id;

  update public.travel_maps
     set timeline_order_revision = timeline_order_revision + 1,
         updated_at = now()
   where id = p_map_id
     and timeline_order_revision = v_current_revision
  returning timeline_order_revision into v_next_revision;

  if v_next_revision is null then
    raise exception 'This timeline changed in another session. Reload before saving the order.';
  end if;

  return v_next_revision;
end;
$$;

revoke all on function public.reorder_private_trips(uuid, bigint, uuid[]) from public;
revoke all on function public.reorder_private_trips(uuid, bigint, uuid[]) from anon;
grant execute on function public.reorder_private_trips(uuid, bigint, uuid[]) to authenticated;

comment on function public.reorder_private_trips(uuid, bigint, uuid[]) is
  'Atomically replaces the complete trip order for an editable map and rejects stale revisions.';
