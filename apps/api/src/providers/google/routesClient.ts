import { ProviderError, type RouteResult, type RoutesProvider, type Waypoint } from '../types.js';
import { googleRequest, parseDuration } from './http.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.legs.duration',
  'routes.legs.distanceMeters',
  'routes.legs.polyline.encodedPolyline',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.polyline.encodedPolyline',
].join(',');

interface GoogleRoutesResponse {
  routes?: {
    duration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
    legs?: {
      duration?: string;
      distanceMeters?: number;
      polyline?: { encodedPolyline?: string };
      steps?: { staticDuration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }[];
    }[];
  }[];
}

const toWaypoint = (w: Waypoint): Record<string, unknown> =>
  w.placeId && !w.placeId.startsWith('demo:')
    ? { placeId: w.placeId }
    : { location: { latLng: { latitude: w.location.lat, longitude: w.location.lng } } };

export class GoogleRoutesProvider implements RoutesProvider {
  constructor(private readonly apiKey: string) {}

  async computeRoute(origin: Waypoint, destination: Waypoint, intermediates: Waypoint[] = []): Promise<RouteResult> {
    const res = await googleRequest<GoogleRoutesResponse>('Routes API', ROUTES_URL, {
      method: 'POST',
      apiKey: this.apiKey,
      fieldMask: FIELD_MASK,
      timeoutMs: 20_000,
      body: {
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        intermediates: intermediates.map(toWaypoint),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        computeAlternativeRoutes: false,
        languageCode: 'en-US',
        units: 'IMPERIAL',
      },
    });

    const route = res.routes?.[0];
    if (!route) {
      throw new ProviderError('No driving route could be found between these places.', 422, 'NO_ROUTE');
    }
    const legs = (route.legs ?? []).map((leg) => ({
      durationSeconds: parseDuration(leg.duration),
      distanceMeters: leg.distanceMeters ?? 0,
      polyline: leg.polyline?.encodedPolyline ?? '',
      steps: (leg.steps ?? []).map((s) => ({
        durationSeconds: parseDuration(s.staticDuration),
        distanceMeters: s.distanceMeters ?? 0,
        polyline: s.polyline?.encodedPolyline ?? '',
      })),
    }));
    return {
      durationSeconds: parseDuration(route.duration),
      distanceMeters: route.distanceMeters ?? 0,
      polyline: route.polyline?.encodedPolyline ?? '',
      legs,
    };
  }
}
