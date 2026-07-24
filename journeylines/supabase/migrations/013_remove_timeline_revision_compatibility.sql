-- GlobeHoppers v8.2.8 chronological timeline cleanup
-- Run in Development only after the v8.2.8 chronological frontend is deployed
-- and verified. The frontend no longer requests timeline_order_revision.

begin;

-- Migration 011 already removed the manual-order RPC and trigger. Repeat these
-- drops defensively in case an environment still contains them.
drop function if exists public.reorder_private_trips(uuid, bigint, uuid[]);
drop trigger if exists trg_assign_trip_sort_order on public.trips;
drop function if exists private.assign_trip_sort_order();

alter table public.travel_maps
  drop column if exists timeline_order_revision;

commit;
