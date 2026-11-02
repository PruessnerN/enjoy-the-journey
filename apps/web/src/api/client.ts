import type {
  ApiErrorBody,
  AppConfig,
  DayUpdate,
  LatLng,
  PlaceCandidate,
  PlaceInfo,
  PlaceSuggestion,
  Trip,
  TripListItem,
  TripRequest,
} from '@journey/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, 'network_error');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const err = body as Partial<ApiErrorBody> | undefined;
    throw new ApiError(err?.message ?? `Request failed (${response.status})`, response.status, err?.error ?? 'error');
  }
  return body as T;
}

const json = (value: unknown): string => JSON.stringify(value);
const qs = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v));
  return search.toString();
};

export const api = {
  config: () => request<AppConfig>('/config'),

  autocomplete: (q: string, session: string, bias?: LatLng) =>
    request<PlaceSuggestion[]>(`/places/autocomplete?${qs({ q, session, lat: bias?.lat, lng: bias?.lng })}`),
  place: (placeId: string, session?: string) =>
    request<PlaceInfo>(`/places/${encodeURIComponent(placeId)}?${qs({ session })}`),

  listTrips: () => request<TripListItem[]>('/trips'),
  getTrip: (id: string) => request<Trip>(`/trips/${id}`),
  createTrip: (body: TripRequest) => request<Trip>('/trips', { method: 'POST', body: json(body) }),
  renameTrip: (id: string, name: string) => request<Trip>(`/trips/${id}`, { method: 'PATCH', body: json({ name }) }),
  deleteTrip: (id: string) => request<void>(`/trips/${id}`, { method: 'DELETE' }),
  replanTrip: (id: string, body?: TripRequest) =>
    request<Trip>(`/trips/${id}/replan`, { method: 'POST', body: json(body ? { request: body } : {}) }),

  updateDay: (id: string, index: number, body: DayUpdate) =>
    request<Trip>(`/trips/${id}/days/${index}`, { method: 'PUT', body: json(body) }),
  regenerateDay: (id: string, index: number, freshIdeas: boolean) =>
    request<Trip>(`/trips/${id}/days/${index}/regenerate`, { method: 'POST', body: json({ freshIdeas }) }),
  alternatives: (id: string, index: number, stopId: string) =>
    request<PlaceCandidate[]>(`/trips/${id}/days/${index}/stops/${stopId}/alternatives`),
  searchDay: (id: string, index: number, q: string, near?: LatLng) =>
    request<PlaceCandidate[]>(`/trips/${id}/days/${index}/search?${qs({ q, lat: near?.lat, lng: near?.lng })}`),

  calendarUrl: (id: string) => `/api/trips/${id}/calendar.ics`,
};
