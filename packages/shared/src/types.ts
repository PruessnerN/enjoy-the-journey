import type { ActivityFrequency, Bounds, LatLng, Link, MealType, PlaceInfo, StopInput, TripRequest } from './schemas.js';

export type DataSource = 'google' | 'demo';

export type IssueSeverity = 'info' | 'warning';

export type IssueCode =
  | 'closed'
  | 'opens_later'
  | 'free_time'
  | 'meal_skipped'
  | 'after_dark'
  | 'meal_outside_window'
  | 'late_arrival'
  | 'night_driving'
  | 'long_drive'
  | 'pinned_late'
  | 'no_lodging_found'
  | 'no_restaurant_found'
  | 'no_activities_found'
  | 'book_rental'
  | 'estimated_route'
  | 'event_timing';

export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
}

/** A stop on the timeline. Times are ISO-8601 instants (UTC); render them in `timeZone`. */
export interface Stop extends StopInput {
  id: string;
  locked: boolean;
  source: 'planner' | 'user';
  arrival: string;
  start: string;
  departure: string;
  timeZone: string;
  waitMinutes: number;
  issues: Issue[];
}

/** The drive that ends at the stop with the same index. */
export interface Leg {
  durationSeconds: number;
  distanceMeters: number;
  /** Extra time reserved for fuel/restroom breaks on long stretches. */
  breakMinutes: number;
  polyline?: string;
  /** True when the leg was estimated rather than routed by the routing provider. */
  estimated: boolean;
}

export interface TripDay {
  index: number;
  /** Local calendar date (YYYY-MM-DD) at the start of the day. */
  date: string;
  /** Local departure time (HH:mm). */
  startTime: string;
  departure: string;
  timeZone: string;
  start: PlaceInfo;
  stops: Stop[];
  legs: Leg[];
  arrival: string;
  driveSeconds: number;
  distanceMeters: number;
  /** Sunrise at the day's start. */
  sunrise?: string;
  /** Sunset at the day's final stop (tonight's lodging or the destination). */
  sunset?: string;
  issues: Issue[];
  /** Set on free days spent at a main event (no driving planned). */
  stay?: { eventId: string; name: string };
}

export interface TripSummary {
  days: number;
  nights: number;
  totalDriveSeconds: number;
  totalDistanceMeters: number;
  directDriveSeconds: number;
  directDistanceMeters: number;
  activityCount: number;
  mealCount: number;
}

export interface Trip {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  request: TripRequest;
  days: TripDay[];
  summary: TripSummary;
  overviewPolyline: string;
  dataSource: DataSource;
  issues: Issue[];
}

export interface TripListItem {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  originName: string;
  destinationName: string;
  mainEventCount: number;
  roundTrip: boolean;
  departureDate: string;
  days: number;
  totalDriveSeconds: number;
}

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText?: string;
}

export interface PlaceCandidate {
  place: PlaceInfo;
  /** Estimated extra minutes needed to visit this place compared to staying on the route. */
  detourMinutes?: number;
  distanceFromRouteMeters?: number;
  score?: number;
}

export interface SwapSearchResult {
  category: string;
  /** The area searched; results all lie inside it. */
  area: Bounds;
  results: PlaceCandidate[];
  nextPageToken?: string;
}

export interface ActivityDefinition {
  id: string;
  label: string;
  emoji: string;
  category: ActivityCategoryId;
  description: string;
  query: string;
  includedType?: string;
  durationMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  outdoor: boolean;
  defaultFrequency: ActivityFrequency;
}

export type ActivityCategoryId = 'outdoors' | 'food' | 'culture' | 'family' | 'quirky';

export interface MealDefinition {
  type: MealType;
  label: string;
  emoji: string;
  windowStart: string;
  windowEnd: string;
  target: string;
  durationMinutes: number;
  query: string;
  includedType?: string;
}

export interface LodgingDefinition {
  label: string;
  emoji: string;
  description: string;
  query: string;
  includedType?: string;
  fallbackQuery?: string;
}

export interface AppConfig {
  dataSource: DataSource;
  mapsBrowserKey: string | null;
  mapId: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

export type { LatLng, Link };
