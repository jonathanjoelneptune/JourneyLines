-- GlobeHoppers v8.2.8 WP6 rollback
-- Removes the manual timeline-ordering database objects created by
-- 010_reorder_private_trips.sql.
--
-- Run this in GlobeHoppers Development only after reverting the WP6
-- manual-ordering frontend code. The existing trips.sort_order column is
-- retained for compatibility, but it is reset to deterministic chronological
-- order based on trip dates.

begin;

-- Remove the public RPC used to save an arbitrary manual trip order.
drop function if exists public.reorder_private_trips(uuid, bigint, uuid[]);

-- Remove the insert trigger that appended new trips to a manual order.
drop trigger if exists trg_assign_trip_sort_order on public.trips;

-- Remove the trigger function created by migration 010.
drop function if exists private.assign_trip_sort_order();

-- Remove the map-level revision used only for manual ordering concurrency.
alter table public.travel_maps
  drop column if exists timeline_order_revision;

-- Restore a deterministic chronological compatibility value in sort_order.
-- The application should use trip dates as the authoritative timeline order.
with ranked as (
  select
    id,
    row_number() over (
      partition by map_id
      order by
        start_date asc nulls last,
        end_date asc nulls last,
        created_at asc,
        id asc
    ) - 1 as chronological_order
  from public.trips
)
update public.trips as t
set sort_order = ranked.chronological_order
from ranked
where ranked.id = t.id
  and t.sort_order is distinct from ranked.chronological_order;

commit;

-- Optional verification queries:
--
-- Confirm the manual-order function is gone:
-- select to_regprocedure(
--   'public.reorder_private_trips(uuid,bigint,uuid[])'
-- );
--
-- Confirm the revision column is gone:
-- select column_name
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'travel_maps'
--   and column_name = 'timeline_order_revision';
--
-- Review chronological ordering:
-- select map_id, id, title, start_date, end_date, sort_order
-- from public.trips
-- order by map_id, start_date nulls last, end_date nulls last, created_at, id;
