import { decodePolyline, encodePolyline, type LatLng, type PlaceInfo, type PlaceSuggestion } from '@journey/shared';
import { bearingDegrees, destinationPoint, haversineMeters, interpolate } from '../../geo/geo.js';
import { timeZoneAt } from '../../geo/time.js';
import { hashString, pick, seededRandom } from '../../util/random.js';
import {
  ProviderError,
  type AutocompleteOptions,
  type DataProvider,
  type PlacesProvider,
  type RouteLegResult,
  type RouteResult,
  type RoutesProvider,
  type TextSearchRequest,
  type Waypoint,
} from '../types.js';
import { DEMO_CITIES } from './cities.js';
import { themeFor } from './themes.js';

const CITY_PREFIX = 'demo:city:';
const PLACE_PREFIX = 'demo:place:';

interface City {
  name: string;
  region: string;
  location: LatLng;
}

const CITIES: City[] = DEMO_CITIES.map(([name, region, lat, lng]) => ({ name, region, location: { lat, lng } }));

function nearestCity(p: LatLng): { city: City; meters: number } {
  let best = CITIES[0]!;
  let bestMeters = Infinity;
  for (const city of CITIES) {
    const d = haversineMeters(p, city.location);
    if (d < bestMeters) {
      best = city;
      bestMeters = d;
    }
  }
  return { city: best, meters: bestMeters };
}

function matchRank(city: City, q: string): number {
  const name = city.name.toLowerCase();
  if (name === q || `${name}, ${city.region.toLowerCase()}` === q) return 0;
  return name.startsWith(q) ? 1 : 2;
}

function cityPlace(city: City, index: number): PlaceInfo {
  return {
    placeId: `${CITY_PREFIX}${index}`,
    name: `${city.name}, ${city.region}`,
    address: `${city.name}, ${city.region}, USA`,
    location: city.location,
    primaryType: 'locality',
    primaryTypeLabel: 'City',
    timeZone: timeZoneAt(city.location),
    googleMapsUri: mapsSearchUrl(city.location),
  };
}

function mapsSearchUrl(p: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

/** Plausible-looking but entirely synthetic data. Deterministic for a given input. */
class DemoPlacesProvider implements PlacesProvider {
  private readonly registry = new Map<string, PlaceInfo>();

  async autocomplete(input: string, _options?: AutocompleteOptions): Promise<PlaceSuggestion[]> {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return CITIES.map((city, index) => ({ city, index }))
      .filter(({ city }) => `${city.name}, ${city.region}`.toLowerCase().includes(q))
      .sort((x, y) => matchRank(x.city, q) - matchRank(y.city, q))
      .slice(0, 6)
      .map(({ city, index }) => ({
        placeId: `${CITY_PREFIX}${index}`,
        primaryText: city.name,
        secondaryText: `${city.region}, USA`,
      }));
  }

  async getPlace(placeId: string): Promise<PlaceInfo> {
    if (placeId.startsWith(CITY_PREFIX)) {
      const index = Number(placeId.slice(CITY_PREFIX.length));
      const city = CITIES[index];
      if (city) return cityPlace(city, index);
    }
    const place = this.registry.get(placeId);
    if (place) return place;
    throw new ProviderError(`Unknown demo place: ${placeId}`, 404);
  }

  async searchText(request: TextSearchRequest): Promise<PlaceInfo[]> {
    const theme = themeFor(request.query, request.includedType);
    const anchors = request.alongRoutePolyline
      ? anchorsAlongPath(decodePolyline(request.alongRoutePolyline))
      : request.near
        ? anchorsAround(request.near.center, request.near.radiusMeters)
        : [];

    const results: PlaceInfo[] = [];
    for (const anchor of anchors) {
      const seed = hashString(`${theme.typeLabel}|${anchor.lat.toFixed(2)}|${anchor.lng.toFixed(2)}`);
      const rng = seededRandom(seed);
      if (rng() > theme.density) continue;
      const count = rng() < 0.3 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const offsetMeters = 250 + rng() * theme.maxOffsetKm * 1000;
        const location = destinationPoint(anchor, rng() * 360, offsetMeters);
        const { city } = nearestCity(location);
        const id = `${PLACE_PREFIX}${seed.toString(36)}-${i}`;
        const rating = Math.round((3.2 + 1.75 * Math.sqrt(rng())) * 10) / 10;
        const place: PlaceInfo = {
          placeId: id,
          name: theme.name(rng, city.name),
          address: `${100 + Math.floor(rng() * 9800)} ${pick(rng, ['Main St', 'Old Highway 30', 'River Rd', 'Canyon Dr', 'Frontage Rd', 'Depot St'])}, ${city.name}, ${city.region}`,
          location,
          rating: Math.min(5, rating),
          userRatingCount: Math.floor(4 + rng() ** 2 * 2500),
          priceLevel: 1 + Math.floor(rng() * 3),
          googleMapsUri: mapsSearchUrl(location),
          primaryType: theme.primaryType,
          primaryTypeLabel: theme.typeLabel,
          types: [theme.primaryType, 'point_of_interest'],
          timeZone: timeZoneAt(location),
          ...(theme.hours ? { openingHours: theme.hours } : {}),
        };
        this.registry.set(id, place);
        results.push(place);
      }
    }
    return results
      .sort((x, y) => (y.rating ?? 0) * Math.log10((y.userRatingCount ?? 0) + 10) - (x.rating ?? 0) * Math.log10((x.userRatingCount ?? 0) + 10))
      .slice(0, Math.min(20, request.maxResults ?? 20));
  }
}

function anchorsAlongPath(path: LatLng[]): LatLng[] {
  if (path.length === 0) return [];
  const total = path.slice(1).reduce((sum, p, i) => sum + haversineMeters(path[i]!, p), 0);
  const count = Math.max(3, Math.min(14, Math.round(total / 25_000)));
  const anchors: LatLng[] = [];
  for (let k = 0; k < count; k++) {
    anchors.push(pointAlong(path, (total * (k + 0.5)) / count));
  }
  return anchors;
}

function anchorsAround(center: LatLng, radiusMeters: number): LatLng[] {
  const anchors: LatLng[] = [center];
  for (let k = 0; k < 8; k++) {
    anchors.push(destinationPoint(center, k * 45, radiusMeters * (k % 2 === 0 ? 0.35 : 0.7)));
  }
  return anchors;
}

function pointAlong(path: LatLng[], meters: number): LatLng {
  let remaining = meters;
  for (let i = 1; i < path.length; i++) {
    const d = haversineMeters(path[i - 1]!, path[i]!);
    if (remaining <= d) return interpolate(path[i - 1]!, path[i]!, d > 0 ? remaining / d : 0);
    remaining -= d;
  }
  return path[path.length - 1]!;
}

/** Synthesises a gently curving road between waypoints with realistic speeds. */
class DemoRoutesProvider implements RoutesProvider {
  async computeRoute(origin: Waypoint, destination: Waypoint, intermediates: Waypoint[] = []): Promise<RouteResult> {
    const stops = [origin, ...intermediates, destination];
    const legs: RouteLegResult[] = [];
    for (let i = 1; i < stops.length; i++) {
      legs.push(buildLeg(stops[i - 1]!.location, stops[i]!.location));
    }
    const allPoints = legs.flatMap((leg, i) => {
      const pts = decodePolyline(leg.polyline);
      return i === 0 ? pts : pts.slice(1);
    });
    return {
      durationSeconds: legs.reduce((s, l) => s + l.durationSeconds, 0),
      distanceMeters: legs.reduce((s, l) => s + l.distanceMeters, 0),
      polyline: encodePolyline(allPoints),
      legs,
    };
  }
}

function buildLeg(from: LatLng, to: LatLng): RouteLegResult {
  const straight = haversineMeters(from, to);
  if (straight > 4_500_000) {
    throw new ProviderError('No driving route could be found between these places.', 422, 'NO_ROUTE');
  }
  const roadMeters = Math.max(200, straight * 1.22);
  // Short hops are on local roads; long legs are mostly highway.
  const speedKmh = roadMeters < 10_000 ? 45 : roadMeters < 50_000 ? 70 : 100;
  const durationSeconds = Math.max(60, (roadMeters / 1000 / speedKmh) * 3600);

  const segments = Math.max(2, Math.min(400, Math.round(straight / 2_500)));
  const bearing = bearingDegrees(from, to);
  const amplitude = Math.min(straight * 0.04, 12_000);
  const wiggle = (hashString(`${from.lat},${from.lng}`) % 3) + 1;
  const points: LatLng[] = [];
  for (let k = 0; k <= segments; k++) {
    const t = k / segments;
    const base = interpolate(from, to, t);
    const offset = Math.sin(t * Math.PI * wiggle) * amplitude * Math.sin(t * Math.PI);
    points.push(k === 0 || k === segments ? base : destinationPoint(base, bearing + 90, offset));
  }

  const stepSize = 25;
  const steps = [];
  for (let s = 0; s < points.length - 1; s += stepSize) {
    const slice = points.slice(s, Math.min(points.length, s + stepSize + 1));
    const fraction = (slice.length - 1) / (points.length - 1);
    steps.push({
      durationSeconds: durationSeconds * fraction,
      distanceMeters: roadMeters * fraction,
      polyline: encodePolyline(slice),
    });
  }
  return { durationSeconds, distanceMeters: roadMeters, polyline: encodePolyline(points), steps };
}

export function createDemoProvider(): DataProvider {
  return { source: 'demo', places: new DemoPlacesProvider(), routes: new DemoRoutesProvider() };
}

export { nearestCity as nearestDemoCity };
