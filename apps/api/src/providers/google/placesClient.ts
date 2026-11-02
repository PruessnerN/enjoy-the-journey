import type { OpeningPeriod, PlaceInfo, PlaceSuggestion } from '@journey/shared';
import { ProviderError, type AutocompleteOptions, type PlacesProvider, type SearchPage, type TextSearchRequest } from '../types.js';
import { googleRequest } from './http.js';

const BASE_URL = 'https://places.googleapis.com/v1';

/** Fields we need to plan well: ratings and opening hours put this in the Enterprise SKU. */
const PLACE_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'priceLevel',
  'googleMapsUri',
  'websiteUri',
  'nationalPhoneNumber',
  'primaryType',
  'primaryTypeDisplayName',
  'types',
  'regularOpeningHours',
  'timeZone',
  'businessStatus',
];

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

interface GooglePoint {
  day?: number;
  hour?: number;
  minute?: number;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  regularOpeningHours?: { periods?: { open?: GooglePoint; close?: GooglePoint }[] };
  timeZone?: { id?: string };
  businessStatus?: string;
}

interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }[];
}

export class GooglePlacesProvider implements PlacesProvider {
  constructor(private readonly apiKey: string) {}

  async autocomplete(input: string, options: AutocompleteOptions = {}): Promise<PlaceSuggestion[]> {
    const body: Record<string, unknown> = { input, languageCode: 'en' };
    if (options.sessionToken) body.sessionToken = options.sessionToken;
    if (options.bias) {
      body.locationBias = {
        circle: { center: { latitude: options.bias.lat, longitude: options.bias.lng }, radius: 50_000 },
      };
    }
    const res = await googleRequest<AutocompleteResponse>('Places API', `${BASE_URL}/places:autocomplete`, {
      method: 'POST',
      apiKey: this.apiKey,
      body,
    });
    return (res.suggestions ?? []).flatMap((s) => {
      const p = s.placePrediction;
      if (!p?.placeId) return [];
      const primary = p.structuredFormat?.mainText?.text ?? p.text?.text ?? '';
      const secondary = p.structuredFormat?.secondaryText?.text;
      return [{ placeId: p.placeId, primaryText: primary, ...(secondary ? { secondaryText: secondary } : {}) }];
    });
  }

  async getPlace(placeId: string, sessionToken?: string): Promise<PlaceInfo> {
    const params = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
    const place = await googleRequest<GooglePlace>('Places API', `${BASE_URL}/places/${encodeURIComponent(placeId)}${params}`, {
      method: 'GET',
      apiKey: this.apiKey,
      fieldMask: PLACE_FIELDS.join(','),
    });
    const info = toPlaceInfo(place);
    if (!info) throw new ProviderError('Google returned a place without a location', 502);
    return info;
  }

  async searchText(request: TextSearchRequest): Promise<PlaceInfo[]> {
    return (await this.searchPage(request)).places;
  }

  async searchPage(request: TextSearchRequest, pageToken?: string): Promise<SearchPage> {
    const body: Record<string, unknown> = {
      textQuery: request.query,
      pageSize: Math.min(20, request.maxResults ?? 20),
      languageCode: 'en',
    };
    if (request.includedType) body.includedType = request.includedType;
    if (request.alongRoutePolyline) {
      body.searchAlongRouteParameters = { polyline: { encodedPolyline: request.alongRoutePolyline } };
    } else if (request.within) {
      // Text Search's locationRestriction returns far too little for queries like "disc golf course"
      // (often just one place), so bias to the rectangle and keep only the places inside it below.
      const b = request.within;
      body.locationBias = {
        rectangle: { low: { latitude: b.south, longitude: b.west }, high: { latitude: b.north, longitude: b.east } },
      };
    } else if (request.near) {
      body.locationBias = {
        circle: {
          center: { latitude: request.near.center.lat, longitude: request.near.center.lng },
          radius: Math.min(50_000, Math.max(100, request.near.radiusMeters)),
        },
      };
    }

    // A page token is only valid with the exact same request that produced it.
    if (pageToken) body.pageToken = pageToken;
    const run = (payload: Record<string, unknown>) =>
      googleRequest<{ places?: GooglePlace[]; nextPageToken?: string }>('Places API', `${BASE_URL}/places:searchText`, {
        method: 'POST',
        apiKey: this.apiKey,
        fieldMask: [...PLACE_FIELDS.map((f) => `places.${f}`), 'nextPageToken'].join(','),
        body: payload,
      });

    let res: { places?: GooglePlace[]; nextPageToken?: string };
    try {
      res = await run(body);
    } catch (error) {
      // An unsupported includedType is a 400; retry once with the text query alone.
      if (error instanceof ProviderError && error.statusCode === 400 && body.includedType) {
        const { includedType: _ignored, ...rest } = body;
        res = await run(rest);
      } else {
        throw error;
      }
    }

    const all = (res.places ?? [])
      .filter((p) => !p.businessStatus || p.businessStatus === 'OPERATIONAL')
      .map(toPlaceInfo)
      .filter((p): p is PlaceInfo => p !== null);
    if (!request.within) return { places: all, ...(res.nextPageToken ? { nextPageToken: res.nextPageToken } : {}) };

    const b = request.within;
    const places = all.filter((p) => p.location.lat >= b.south && p.location.lat <= b.north && p.location.lng >= b.west && p.location.lng <= b.east);
    // Once results spill outside the area, later pages are almost all outside it: don't pay for them.
    const worthMore = res.nextPageToken && places.length * 2 >= all.length;
    return { places, ...(worthMore ? { nextPageToken: res.nextPageToken } : {}) };
  }
}

function toPlaceInfo(p: GooglePlace): PlaceInfo | null {
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  if (lat === undefined || lng === undefined) return null;
  const info: PlaceInfo = {
    name: p.displayName?.text ?? p.formattedAddress ?? 'Unnamed place',
    location: { lat, lng },
  };
  if (p.id) info.placeId = p.id;
  if (p.formattedAddress) info.address = p.formattedAddress;
  if (typeof p.rating === 'number') info.rating = p.rating;
  if (typeof p.userRatingCount === 'number') info.userRatingCount = p.userRatingCount;
  if (p.priceLevel && p.priceLevel in PRICE_LEVELS) info.priceLevel = PRICE_LEVELS[p.priceLevel];
  if (p.googleMapsUri) info.googleMapsUri = p.googleMapsUri;
  if (p.websiteUri) info.websiteUri = p.websiteUri;
  if (p.nationalPhoneNumber) info.phone = p.nationalPhoneNumber;
  if (p.primaryType) info.primaryType = p.primaryType;
  if (p.primaryTypeDisplayName?.text) info.primaryTypeLabel = p.primaryTypeDisplayName.text;
  if (p.types?.length) info.types = p.types.slice(0, 20);
  if (p.timeZone?.id) info.timeZone = p.timeZone.id;
  const periods = toOpeningPeriods(p.regularOpeningHours?.periods);
  if (periods) info.openingHours = periods;
  return info;
}

function toOpeningPeriods(periods: { open?: GooglePoint; close?: GooglePoint }[] | undefined): OpeningPeriod[] | undefined {
  if (!periods?.length) return undefined;
  const result: OpeningPeriod[] = [];
  for (const period of periods) {
    if (!period.open) continue;
    const open = { day: period.open.day ?? 0, hour: period.open.hour ?? 0, minute: period.open.minute ?? 0 };
    if (period.close) {
      result.push({ open, close: { day: period.close.day ?? 0, hour: period.close.hour ?? 0, minute: period.close.minute ?? 0 } });
    } else {
      result.push({ open });
    }
  }
  return result.length > 0 ? result : undefined;
}
