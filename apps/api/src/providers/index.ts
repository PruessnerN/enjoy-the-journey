import type { PlaceInfo, PlaceSuggestion } from '@journey/shared';
import { createLimiter, type Limiter } from '../util/limiter.js';
import { TtlCache } from '../util/ttlCache.js';
import { createDemoProvider } from './demo/demoProvider.js';
import { GooglePlacesProvider } from './google/placesClient.js';
import { GoogleRoutesProvider } from './google/routesClient.js';
import type {
  AutocompleteOptions,
  DataProvider,
  PlacesProvider,
  RouteResult,
  RoutesProvider,
  TextSearchRequest,
  Waypoint,
} from './types.js';

export interface ProviderOptions {
  googleApiKey?: string | undefined;
  forceDemo?: boolean;
  cacheTtlMinutes: number;
  concurrency: number;
}

/**
 * Caches identical upstream requests for a while (re-planning a trip repeats many
 * searches) and caps concurrency so a big plan does not burst the API.
 */
class CachedPlaces implements PlacesProvider {
  private readonly searchCache: TtlCache<PlaceInfo[]>;
  private readonly placeCache: TtlCache<PlaceInfo>;
  private readonly autocompleteCache: TtlCache<PlaceSuggestion[]>;

  constructor(
    private readonly inner: PlacesProvider,
    ttlMs: number,
    private readonly limit: Limiter,
  ) {
    this.searchCache = new TtlCache(ttlMs, 3_000);
    this.placeCache = new TtlCache(ttlMs, 3_000);
    this.autocompleteCache = new TtlCache(Math.min(ttlMs, 30 * 60_000), 1_000);
  }

  autocomplete(input: string, options?: AutocompleteOptions): Promise<PlaceSuggestion[]> {
    const bias = options?.bias ? `${options.bias.lat.toFixed(1)},${options.bias.lng.toFixed(1)}` : '';
    return this.autocompleteCache.getOrLoad(`${input.toLowerCase()}|${bias}`, () =>
      this.limit(() => this.inner.autocomplete(input, options)),
    );
  }

  getPlace(placeId: string, sessionToken?: string): Promise<PlaceInfo> {
    return this.placeCache.getOrLoad(placeId, () => this.limit(() => this.inner.getPlace(placeId, sessionToken)));
  }

  searchText(request: TextSearchRequest): Promise<PlaceInfo[]> {
    return this.searchCache.getOrLoad(JSON.stringify(request), () => this.limit(() => this.inner.searchText(request)));
  }
}

class CachedRoutes implements RoutesProvider {
  private readonly cache: TtlCache<RouteResult>;

  constructor(
    private readonly inner: RoutesProvider,
    ttlMs: number,
    private readonly limit: Limiter,
  ) {
    this.cache = new TtlCache(ttlMs, 500);
  }

  computeRoute(origin: Waypoint, destination: Waypoint, intermediates: Waypoint[] = []): Promise<RouteResult> {
    const key = [origin, ...intermediates, destination]
      .map((w) => w.placeId ?? `${w.location.lat.toFixed(6)},${w.location.lng.toFixed(6)}`)
      .join('>');
    return this.cache.getOrLoad(key, () => this.limit(() => this.inner.computeRoute(origin, destination, intermediates)));
  }
}

export function createDataProvider(options: ProviderOptions): DataProvider {
  const base: DataProvider =
    options.googleApiKey && !options.forceDemo
      ? {
          source: 'google',
          places: new GooglePlacesProvider(options.googleApiKey),
          routes: new GoogleRoutesProvider(options.googleApiKey),
        }
      : createDemoProvider();

  const ttlMs = options.cacheTtlMinutes * 60_000;
  const limit = createLimiter(options.concurrency);
  return {
    source: base.source,
    places: new CachedPlaces(base.places, ttlMs, limit),
    routes: new CachedRoutes(base.routes, ttlMs, limit),
  };
}

export * from './types.js';
