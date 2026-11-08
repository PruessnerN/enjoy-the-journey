import type { MainEvent, PlaceInfo, TripRequest } from './schemas.js';

const shortName = (name: string) => name.split(',')[0]!.trim();

/** Every place the trip is built around, in order: start, main events, then the end. */
export function routePlaces(request: Pick<TripRequest, 'origin' | 'destination' | 'mainEvents' | 'roundTrip'>): PlaceInfo[] {
  return [request.origin, ...(request.mainEvents ?? []).map((e) => e.place), request.roundTrip ? request.origin : request.destination];
}

/** "Boise → Yellowstone → Boise", shortened for long routes. */
export function routeLabel(request: Pick<TripRequest, 'origin' | 'destination' | 'mainEvents' | 'roundTrip'>, maxPlaces = 4): string {
  const names = routePlaces(request).map((p) => shortName(p.name));
  if (names.length <= maxPlaces) return names.join(' → ');
  return `${names[0]} → ${names[1]} → … → ${names[names.length - 1]} (${names.length - 2} main events)`;
}

/** "2 nights" / "3 hours". */
export function stayLabel(event: Pick<MainEvent, 'stayUnit' | 'stayAmount'>): string {
  const unit = event.stayUnit === 'nights' ? 'night' : 'hour';
  return `${event.stayAmount} ${unit}${event.stayAmount === 1 ? '' : 's'}`;
}
