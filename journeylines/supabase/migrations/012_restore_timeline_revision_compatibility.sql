-- GlobeHoppers emergency compatibility repair
-- Restores the column expected by the currently deployed WP6 frontend
-- without restoring manual timeline ordering.
--
-- Run in GlobeHoppers Development.

begin;

alter table public.travel_maps
  add column if not exists timeline_order_revision bigint not null default 0;

-- Keep all existing maps at a neutral revision.
update public.travel_maps
set timeline_order_revision = 0
where timeline_order_revision is distinct from 0;

commit;

-- Verification:
-- select id, owner_id, name, timeline_order_revision
-- from public.travel_maps
-- order by created_at;
