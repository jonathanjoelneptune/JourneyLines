import { JsonTravelRepository } from './JsonTravelRepository.js';
import { SupabaseTravelRepository } from './SupabaseTravelRepository.js';

export function createTravelRepository({ cloudEnabled, mapId }) {
  if (cloudEnabled) {
    if (!mapId) throw new Error('Your private Globe could not be opened because no travel map was selected.');
    return new SupabaseTravelRepository(mapId);
  }
  return new JsonTravelRepository();
}
