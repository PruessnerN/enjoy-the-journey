import type { Bounds, DataSource, LatLng, PlaceInfo, PlaceSuggestion } from '@journey/shared';

export interface Waypoint {
  location: LatLng;
  placeId?: string;
}

export interface RouteStep {
  durationSeconds: number;
  distanceMeters: number;
  polyline: string;
}

export interface RouteLegResult {
  durationSeconds: number;
  distanceMeters: number;
  polyline: string;
  steps: RouteStep[];
}

export interface RouteResult {
  durationSeconds: number;
  distanceMeters: number;
  polyline: string;
  legs: RouteLegResult[];
}

export interface RoutesProvider {
  computeRoute(origin: Waypoint, destination: Waypoint, intermediates?: Waypoint[]): Promise<RouteResult>;
}

export interface TextSearchRequest {
  query: string;
  includedType?: string;
  /** Bias results to places near this encoded route polyline. */
  alongRoutePolyline?: string;
  /** Bias results to a circle. Ignored when `alongRoutePolyline` is set. */
  near?: { center: LatLng; radiusMeters: number };
  /** Only return places inside this rectangle (e.g. the visible map). Takes precedence over `near`. */
  within?: Bounds;
  maxResults?: number;
}

export interface SearchPage {
  places: PlaceInfo[];
  /** Pass back (with the identical request) to get the next page of results. */
  nextPageToken?: string;
}

export interface AutocompleteOptions {
  bias?: LatLng;
  sessionToken?: string;
}

export interface PlacesProvider {
  autocomplete(input: string, options?: AutocompleteOptions): Promise<PlaceSuggestion[]>;
  getPlace(placeId: string, sessionToken?: string): Promise<PlaceInfo>;
  searchText(request: TextSearchRequest): Promise<PlaceInfo[]>;
  searchPage(request: TextSearchRequest, pageToken?: string): Promise<SearchPage>;
}

export interface DataProvider {
  source: DataSource;
  places: PlacesProvider;
  routes: RoutesProvider;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
