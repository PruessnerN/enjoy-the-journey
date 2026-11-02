import { z } from 'zod';

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const timeOfDaySchema = z.string().regex(TIME_OF_DAY, 'Expected a time formatted as HH:mm');
export const isoDateSchema = z.string().regex(ISO_DATE, 'Expected a date formatted as YYYY-MM-DD');

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const openingPointSchema = z.object({
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(24),
  minute: z.number().int().min(0).max(59),
});

/** Weekly opening period in the place's local time. `day` 0 = Sunday. A missing `close` means open 24/7. */
export const openingPeriodSchema = z.object({
  open: openingPointSchema,
  close: openingPointSchema.optional(),
});

export const placeInfoSchema = z.object({
  placeId: z.string().max(300).optional(),
  name: z.string().min(1).max(200),
  address: z.string().max(400).optional(),
  location: latLngSchema,
  rating: z.number().min(0).max(5).optional(),
  userRatingCount: z.number().int().min(0).optional(),
  priceLevel: z.number().int().min(0).max(4).optional(),
  googleMapsUri: z.string().max(1000).optional(),
  websiteUri: z.string().max(1000).optional(),
  phone: z.string().max(50).optional(),
  primaryType: z.string().max(100).optional(),
  primaryTypeLabel: z.string().max(100).optional(),
  types: z.array(z.string().max(100)).max(60).optional(),
  openingHours: z.array(openingPeriodSchema).max(60).optional(),
  timeZone: z.string().max(64).optional(),
});

export const lodgingTypeSchema = z.enum(['campground', 'vacation_rental', 'hotel']);
export const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner']);
export const paceSchema = z.enum(['relaxed', 'balanced', 'efficient']);
/** once = once per trip, few = 2–3 times per trip (about every other day), daily = up to once a day, often = up to twice a day. */
export const activityFrequencySchema = z.enum(['once', 'few', 'daily', 'often']);
export const activityPrioritySchema = z.enum(['high', 'normal']);

export const activityRequestSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    emoji: z.string().max(16).optional(),
    query: z.string().min(2).max(120),
    includedType: z.string().max(64).optional(),
    durationMinutes: z.number().int().min(10).max(600),
    minDurationMinutes: z.number().int().min(10).max(600),
    frequency: activityFrequencySchema,
    priority: activityPrioritySchema,
    outdoor: z.boolean(),
  })
  .refine((a) => a.minDurationMinutes <= a.durationMinutes, {
    message: 'Minimum duration cannot exceed the typical duration',
    path: ['minDurationMinutes'],
  });

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export const tripPreferencesSchema = z
  .object({
    dayStartTime: timeOfDaySchema,
    arriveByTime: timeOfDaySchema,
    avoidNightDriving: z.boolean(),
    pace: paceSchema,
    maxDrivingHoursPerDay: z.number().min(1).max(14),
    fixedDays: z.number().int().min(1).max(30).nullable(),
    maxDetourMinutes: z.number().int().min(5).max(180),
    minRating: z.number().min(0).max(5),
    /** Cap on activity stops per day (meals excluded). Null or missing = no limit. */
    maxActivitiesPerDay: z.number().int().min(1).max(10).nullable().optional(),
    meals: z.object({
      breakfast: z.boolean(),
      lunch: z.boolean(),
      dinner: z.boolean(),
    }),
    travelers: z.number().int().min(1).max(16),
  })
  .refine((p) => toMinutes(p.arriveByTime) >= toMinutes(p.dayStartTime) + 120, {
    message: 'Your travel day needs to be at least 2 hours long',
    path: ['arriveByTime'],
  });

/** Activities are listed most important first; the planner fills each day in this order. */
export const tripRequestSchema = z.object({
  name: z.string().trim().max(120).optional(),
  origin: placeInfoSchema,
  destination: placeInfoSchema,
  departureDate: isoDateSchema,
  lodgingType: lodgingTypeSchema,
  activities: z.array(activityRequestSchema).min(1, 'Pick at least one activity to enjoy along the way').max(20),
  preferences: tripPreferencesSchema,
});

export const stopKindSchema = z.enum(['activity', 'meal', 'lodging', 'destination', 'custom']);

export const linkSchema = z.object({
  label: z.string().min(1).max(60),
  url: z.string().min(1).max(2000),
});

export const stopInputSchema = z.object({
  id: z.string().max(64).optional(),
  kind: stopKindSchema,
  place: placeInfoSchema,
  activityId: z.string().max(64).optional(),
  activityLabel: z.string().max(80).optional(),
  emoji: z.string().max(16).optional(),
  mealType: mealTypeSchema.optional(),
  durationMinutes: z.number().int().min(0).max(1440),
  pinnedStart: timeOfDaySchema.nullable().optional(),
  locked: z.boolean().optional(),
  outdoor: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
  links: z.array(linkSchema).max(10).optional(),
  source: z.enum(['planner', 'user']).optional(),
});

export const dayUpdateSchema = z.object({
  startTime: timeOfDaySchema.optional(),
  stops: z.array(stopInputSchema).min(1).max(25),
});

export const tripPatchSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const replanSchema = z.object({
  request: tripRequestSchema.optional(),
});

export const regenerateDaySchema = z.object({
  /** When true, the planner avoids the places currently suggested (unlocked) so the user gets fresh ideas. */
  freshIdeas: z.boolean().optional(),
});

export const placeSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(100).optional(),
  type: z.string().max(64).optional(),
});

export const autocompleteQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  session: z.string().max(100).optional(),
});

export type LatLng = z.infer<typeof latLngSchema>;
export type OpeningPeriod = z.infer<typeof openingPeriodSchema>;
export type PlaceInfo = z.infer<typeof placeInfoSchema>;
export type LodgingType = z.infer<typeof lodgingTypeSchema>;
export type MealType = z.infer<typeof mealTypeSchema>;
export type Pace = z.infer<typeof paceSchema>;
export type ActivityFrequency = z.infer<typeof activityFrequencySchema>;
export type ActivityPriority = z.infer<typeof activityPrioritySchema>;
export type ActivityRequest = z.infer<typeof activityRequestSchema>;
export type TripPreferences = z.infer<typeof tripPreferencesSchema>;
export type TripRequest = z.infer<typeof tripRequestSchema>;
export type StopKind = z.infer<typeof stopKindSchema>;
export type Link = z.infer<typeof linkSchema>;
export type StopInput = z.infer<typeof stopInputSchema>;
export type DayUpdate = z.infer<typeof dayUpdateSchema>;
export type TripPatch = z.infer<typeof tripPatchSchema>;
export type ReplanInput = z.infer<typeof replanSchema>;
export type RegenerateDayInput = z.infer<typeof regenerateDaySchema>;
export type PlaceSearchQuery = z.infer<typeof placeSearchQuerySchema>;
export type AutocompleteQuery = z.infer<typeof autocompleteQuerySchema>;
