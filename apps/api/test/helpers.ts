import {
  ACTIVITY_CATALOG,
  activityRequestFromDefinition,
  DEFAULT_PREFERENCES,
  type ActivityRequest,
  type PlaceInfo,
  type TripPreferences,
  type TripRequest,
} from '@journey/shared';
import { createDataProvider } from '../src/providers/index.js';
import type { DataProvider } from '../src/providers/types.js';

export function demoProvider(): DataProvider {
  return createDataProvider({ forceDemo: true, cacheTtlMinutes: 60, concurrency: 8 });
}

export async function cityPlace(provider: DataProvider, name: string): Promise<PlaceInfo> {
  const [suggestion] = await provider.places.autocomplete(name);
  if (!suggestion) throw new Error(`No demo city matches ${name}`);
  return provider.places.getPlace(suggestion.placeId);
}

export function activities(...ids: string[]): ActivityRequest[] {
  return ids.map((id) => {
    const def = ACTIVITY_CATALOG.find((a) => a.id === id);
    if (!def) throw new Error(`Unknown activity ${id}`);
    return activityRequestFromDefinition(def);
  });
}

export async function makeRequest(
  provider: DataProvider,
  from: string,
  to: string,
  overrides: Partial<Omit<TripRequest, 'preferences'>> & { preferences?: Partial<TripPreferences> } = {},
): Promise<TripRequest> {
  const { preferences, ...rest } = overrides;
  return {
    origin: await cityPlace(provider, from),
    destination: await cityPlace(provider, to),
    departureDate: '2026-06-12',
    lodgingType: 'hotel',
    activities: activities('disc_golf', 'scenic_viewpoint', 'museums'),
    ...rest,
    preferences: { ...DEFAULT_PREFERENCES, ...preferences },
  };
}
