import { requireSupabase } from '../lib/supabaseClient.js';
import { supabaseRowsToTravelMap } from '../adapters/supabaseToTravelMap.js';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export class SupabaseTravelRepository {
  constructor(mapId) {
    if (!mapId) throw new Error('A map ID is required to load cloud travel data.');
    this.mapId = mapId;
    this.client = requireSupabase();
  }

  async loadTravelMap() {
    const { data: map, error: mapError } = await this.client
      .from('travel_maps')
      .select('id, owner_id, name, description, slug, is_public, timeline_order_revision, created_at, updated_at')
      .eq('id', this.mapId)
      .single();
    if (mapError) throw mapError;

    const [hoppersResult, tripsResult] = await Promise.all([
      this.client
        .from('hoppers')
        .select('id, map_id, name, color, avatar_url, sort_order, is_active, created_at, updated_at')
        .eq('map_id', this.mapId)
        .order('sort_order', { ascending: true }),
      this.client
        .from('trips')
        .select('id, map_id, title, start_date, end_date, notes, sort_order, occasion, trail_style, trail_color_mode, created_at, updated_at')
        .eq('map_id', this.mapId)
        .order('sort_order', { ascending: true })
        .order('start_date', { ascending: true })
    ]);

    if (hoppersResult.error) throw hoppersResult.error;
    if (tripsResult.error) throw tripsResult.error;

    const tripIds = (tripsResult.data || []).map(row => row.id);
    let legs = [];
    let tripHoppers = [];
    let locations = [];

    if (tripIds.length) {
      const [legsResult, linksResult] = await Promise.all([
        this.client
          .from('trip_legs')
          .select('id, trip_id, from_location_id, to_location_id, transport_mode, leg_order, departure_date, arrival_date, route_label, notes, route_geometry, route_provider, route_version, created_at, updated_at')
          .in('trip_id', tripIds)
          .order('leg_order', { ascending: true }),
        this.client
          .from('trip_hoppers')
          .select('id, trip_id, hopper_id, created_at, updated_at')
          .in('trip_id', tripIds)
      ]);
      if (legsResult.error) throw legsResult.error;
      if (linksResult.error) throw linksResult.error;
      legs = legsResult.data || [];
      tripHoppers = linksResult.data || [];

      const locationIds = [...new Set(legs.flatMap(leg => [leg.from_location_id, leg.to_location_id]).filter(Boolean))];
      if (locationIds.length) {
        const locationsResult = await this.client
          .from('locations')
          .select('id, name, region, country, continent, latitude, longitude, created_at, updated_at')
          .in('id', locationIds);
        if (locationsResult.error) throw locationsResult.error;
        locations = locationsResult.data || [];
      }
    }

    return supabaseRowsToTravelMap({
      map,
      hoppers: hoppersResult.data || [],
      trips: tripsResult.data || [],
      legs,
      tripHoppers,
      locations
    });
  }

  async replaceHoppers(hoppers = []) {
    const normalized = hoppers.map((hopper, index) => ({
      id: isUuid(hopper.id) ? hopper.id : null,
      map_id: this.mapId,
      name: String(hopper.name || '').trim(),
      color: hopper.color || '#2f80ff',
      avatar_url: hopper.avatarUrl || hopper.avatar_url || null,
      sort_order: index,
      is_active: hopper.isActive !== false
    }));

    if (normalized.some(hopper => !hopper.name)) {
      throw new Error('Every Hopper needs a name before saving.');
    }

    const { data: existing, error: existingError } = await this.client
      .from('hoppers')
      .select('id')
      .eq('map_id', this.mapId);
    if (existingError) throw existingError;

    const existingIds = new Set((existing || []).map(row => row.id));
    const retainedIds = new Set(normalized.filter(row => row.id).map(row => row.id));
    const deleteIds = [...existingIds].filter(id => !retainedIds.has(id));

    if (deleteIds.length) {
      const { error } = await this.client
        .from('hoppers')
        .delete()
        .eq('map_id', this.mapId)
        .in('id', deleteIds);
      if (error) throw error;
    }

    const updates = normalized.filter(row => row.id);
    for (const row of updates) {
      const { error } = await this.client
        .from('hoppers')
        .update({
          name: row.name,
          color: row.color,
          avatar_url: row.avatar_url,
          sort_order: row.sort_order,
          is_active: row.is_active
        })
        .eq('map_id', this.mapId)
        .eq('id', row.id);
      if (error) throw error;
    }

    const inserts = normalized.filter(row => !row.id).map(({ id, ...row }) => row);
    if (inserts.length) {
      const { error } = await this.client.from('hoppers').insert(inserts);
      if (error) throw error;
    }

    const { data, error } = await this.client
      .from('hoppers')
      .select('id, map_id, name, color, avatar_url, sort_order, is_active, created_at, updated_at')
      .eq('map_id', this.mapId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async createTrip({ trip, locations = [] } = {}) {
    if (!trip || !Array.isArray(trip.route) || trip.route.length < 2) {
      throw new Error('A trip with at least one route leg is required.');
    }

    const locationById = new Map((locations || []).filter(location => location?.id).map(location => [String(location.id), location]));
    const usedLocationIds = [...new Set(trip.route.map(point => point?.locationId).filter(Boolean).map(String))];
    const locationPayload = usedLocationIds.map(clientId => {
      const location = locationById.get(clientId);
      if (!location) throw new Error(`Location ${clientId} is missing from the current map data.`);
      const latitude = Number(location.lat ?? location.latitude);
      const longitude = Number(location.lon ?? location.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error(`${location.name || clientId} does not have valid coordinates.`);
      }
      return {
        client_id: clientId,
        name: String(location.name || clientId),
        region: location.region || null,
        country: location.country || null,
        continent: location.continent || null,
        latitude,
        longitude
      };
    });

    const modeToDatabase = { plane: 'flight', car: 'drive', drive: 'drive', train: 'train', boat: 'boat', walk: 'walk', other: 'other' };
    const legs = trip.route.slice(1).map((point, index) => {
      const previous = trip.route[index];
      return {
        from_client_id: String(previous.locationId),
        to_client_id: String(point.locationId),
        transport_mode: modeToDatabase[point.modeFromPrevious] || point.modeFromPrevious || 'flight',
        leg_order: index + 1,
        route_label: point.routeLabel || null,
        notes: point.notes || null,
        route_geometry: point.routeGeometry || null,
        route_provider: point.routeProvider || null,
        route_version: point.routeVersion || null
      };
    });

    const toDate = (year, month, day) => {
      if (!year || !month) return null;
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`;
    };

    const { data, error } = await this.client.rpc('create_private_trip', {
      p_map_id: this.mapId,
      p_trip: {
        title: trip.label || trip.title || 'Untitled Hop',
        start_date: toDate(trip.year, trip.month, trip.day),
        end_date: toDate(trip.endYear, trip.endMonth, trip.endDay),
        notes: trip.notes || null,
        sort_order: Number.isFinite(Number(trip.sortOrder)) ? Number(trip.sortOrder) : 0,
        occasion: trip.occasion || null,
        trail_style: trip.trailStyle || 'solid',
        trail_color_mode: trip.trailColorMode || 'members'
      },
      p_locations: locationPayload,
      p_legs: legs,
      p_hopper_ids: (trip.travelers || []).filter(isUuid)
    });
    if (error) throw error;
    return { tripId: data };
  }


  async updateTrip({ tripId, expectedUpdatedAt, trip, locations = [] } = {}) {
    if (!isUuid(tripId)) throw new Error('A valid trip ID is required for editing.');
    if (!trip || !Array.isArray(trip.route) || trip.route.length < 2) {
      throw new Error('A trip with at least one route leg is required.');
    }

    const locationById = new Map((locations || []).filter(location => location?.id).map(location => [String(location.id), location]));
    const usedLocationIds = [...new Set(trip.route.map(point => point?.locationId).filter(Boolean).map(String))];
    const locationPayload = usedLocationIds.map(clientId => {
      const location = locationById.get(clientId);
      if (!location) throw new Error(`Location ${clientId} is missing from the current map data.`);
      const latitude = Number(location.lat ?? location.latitude);
      const longitude = Number(location.lon ?? location.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error(`${location.name || clientId} does not have valid coordinates.`);
      return { client_id: clientId, name: String(location.name || clientId), region: location.region || null, country: location.country || null, continent: location.continent || null, latitude, longitude };
    });

    const modeToDatabase = { plane: 'flight', car: 'drive', drive: 'drive', train: 'train', boat: 'boat', walk: 'walk', other: 'other' };
    const legs = trip.route.slice(1).map((point, index) => ({
      from_client_id: String(trip.route[index].locationId),
      to_client_id: String(point.locationId),
      transport_mode: modeToDatabase[point.modeFromPrevious] || point.modeFromPrevious || 'flight',
      leg_order: index + 1,
      route_label: point.routeLabel || null,
      notes: point.notes || null,
      route_geometry: point.routeGeometry || null,
      route_provider: point.routeProvider || null,
      route_version: point.routeVersion || null
    }));

    const toDate = (year, month, day) => (!year || !month) ? null : `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`;
    const { data, error } = await this.client.rpc('update_private_trip', {
      p_map_id: this.mapId,
      p_trip_id: tripId,
      p_expected_updated_at: expectedUpdatedAt || null,
      p_trip: {
        title: trip.label || trip.title || 'Untitled Hop',
        start_date: toDate(trip.year, trip.month, trip.day),
        end_date: toDate(trip.endYear, trip.endMonth, trip.endDay),
        notes: trip.notes || null,
        sort_order: Number.isFinite(Number(trip.sortOrder)) ? Number(trip.sortOrder) : 0,
        occasion: trip.occasion || null,
        trail_style: trip.trailStyle || 'solid',
        trail_color_mode: trip.trailColorMode || 'members'
      },
      p_locations: locationPayload,
      p_legs: legs,
      p_hopper_ids: (trip.travelers || []).filter(isUuid)
    });
    if (error) {
      if (String(error.message || '').includes('changed in another session')) error.code = 'TRIP_CONFLICT';
      throw error;
    }
    return { tripId: data };
  }


  async reorderTrips({ tripIds = [], expectedRevision = 0 } = {}) {
    if (!Array.isArray(tripIds) || !tripIds.length) {
      throw new Error('At least one trip is required to save timeline order.');
    }
    if (tripIds.some(id => !isUuid(id)) || new Set(tripIds).size !== tripIds.length) {
      throw new Error('The timeline order contains an invalid or duplicate trip. Reload and try again.');
    }

    const { data, error } = await this.client.rpc('reorder_private_trips', {
      p_map_id: this.mapId,
      p_expected_revision: Number(expectedRevision) || 0,
      p_trip_ids: tripIds
    });
    if (error) {
      if (String(error.message || '').includes('changed in another session')) error.code = 'TIMELINE_CONFLICT';
      throw error;
    }
    return { revision: Number(data) || 0 };
  }

  async deleteTrip({ tripId, expectedUpdatedAt } = {}) {
    if (!isUuid(tripId)) throw new Error('A valid trip ID is required for deletion.');
    if (!expectedUpdatedAt) throw new Error('The trip revision is missing. Reload the trip before deleting.');

    const { data, error } = await this.client.rpc('delete_private_trip', {
      p_map_id: this.mapId,
      p_trip_id: tripId,
      p_expected_updated_at: expectedUpdatedAt
    });
    if (error) {
      if (String(error.message || '').includes('changed in another session')) error.code = 'TRIP_CONFLICT';
      throw error;
    }
    return { tripId: data };
  }

}
