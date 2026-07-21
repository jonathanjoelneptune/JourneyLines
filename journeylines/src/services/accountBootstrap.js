import { requireSupabase } from '../lib/supabaseClient.js';

export async function bootstrapAccount() {
  const client = requireSupabase();
  const { data: mapId, error: bootstrapError } = await client.rpc('ensure_default_travel_map');
  if (bootstrapError) throw bootstrapError;

  const [{ data: profile, error: profileError }, { data: maps, error: mapsError }] = await Promise.all([
    client.from('profiles').select('id, display_name, avatar_url, created_at, updated_at').single(),
    client.from('travel_maps').select('id, owner_id, name, description, slug, is_public, timeline_order_revision, created_at, updated_at').order('created_at', { ascending: true })
  ]);

  if (profileError) throw profileError;
  if (mapsError) throw mapsError;

  const normalizedMaps = (maps || []).map(map => ({ ...map, timelineOrderRevision: Number(map.timeline_order_revision) || 0 }));
  const selectedMap = normalizedMaps.find(map => map.id === mapId) || normalizedMaps[0] || null;
  return { profile, maps: normalizedMaps, selectedMap };
}

export async function listSecurityTestHoppers(mapId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('hoppers')
    .select('id, map_id, name, color, sort_order, created_at, updated_at')
    .eq('map_id', mapId)
    .ilike('name', 'RLS Test%')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createSecurityTestHopper(mapId, suffix = '') {
  const client = requireSupabase();
  const name = `RLS Test${suffix ? ` ${suffix}` : ''}`;
  const { data, error } = await client
    .from('hoppers')
    .insert({ map_id: mapId, name, color: '#38bdf8', sort_order: 0 })
    .select('id, map_id, name, color, sort_order, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function attemptDirectHopperRead(hopperId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('hoppers')
    .select('id, map_id, name, color, updated_at')
    .eq('id', hopperId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function attemptDirectHopperUpdate(hopperId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('hoppers')
    .update({ name: `RLS Test updated ${new Date().toISOString()}` })
    .eq('id', hopperId)
    .select('id, map_id, name, updated_at');
  if (error) throw error;
  return data || [];
}

export async function deleteSecurityTestHopper(hopperId) {
  const client = requireSupabase();
  const { error } = await client.from('hoppers').delete().eq('id', hopperId);
  if (error) throw error;
}
