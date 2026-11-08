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

/** A lat/lng rectangle, e.g. the visible map area. */
export const boundsSchema = z
  .object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  })
  .refine((b) => b.south < b.north && b.west < b.east, { message: 'Invalid map area' });

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

export const MAX_MAIN_EVENTS = 10;
export const MAX_EVENT_HOURS = 12;
export const MAX_EVENT_NIGHTS = 30;

export const stayUnitSchema = z.enum(['hours', 'nights']);

/**
 * A place the trip is built around, visited in list order before the destination. Staying for
 * hours keeps the drive going the same day; staying for nights adds free days there.
 */
export const mainEventSchema = z
  .object({
    id: z.string().min(1).max(64),
    place: placeInfoSchema,
    stayUnit: stayUnitSchema,
    stayAmount: z.number().int().min(1).max(MAX_EVENT_NIGHTS),
    /** Day to be there. With hours, `arrivalTime` is when it starts; with nights, when to arrive by. */
    arrivalDate: isoDateSchema.nullable().optional(),
    arrivalTime: timeOfDaySchema.nullable().optional(),
  })
  .refine((e) => e.stayUnit === 'nights' || e.stayAmount <= MAX_EVENT_HOURS, {
    message: `A stop of a few hours can last at most ${MAX_EVENT_HOURS} hours. Use nights for longer stays.`,
    path: ['stayAmount'],
  })
  .refine((e) => !e.arrivalTime || e.arrivalDate, {
    message: 'Pick a date to go with the arrival time',
    path: ['arrivalDate'],
  });

/** Activities are listed most important first; the planner fills each day in this order. */
export const tripRequestSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    origin: placeInfoSchema,
    destination: placeInfoSchema,
    /** Optional places to visit on the way, in order. */
    mainEvents: z.array(mainEventSchema).max(MAX_MAIN_EVENTS, `Add up to ${MAX_MAIN_EVENTS} main events`).optional(),
    /** End where the trip started; `destination` is then the origin. */
    roundTrip: z.boolean().optional(),
    departureDate: isoDateSchema,
    lodgingType: lodgingTypeSchema,
    activities: z.array(activityRequestSchema).min(1, 'Pick at least one activity to enjoy along the way').max(20),
    preferences: tripPreferencesSchema,
  })
  .superRefine((request, ctx) => {
    const events = request.mainEvents ?? [];
    if (request.roundTrip && events.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Add at least one main event for a round trip', path: ['mainEvents'] });
    }
    if (new Set(events.map((e) => e.id)).size !== events.length) {
      ctx.addIssue({ code: 'custom', message: 'Main events must be unique', path: ['mainEvents'] });
    }
    let previous = request.departureDate;
    events.forEach((event, i) => {
      if (!event.arrivalDate) return;
      if (event.arrivalDate < previous) {
        ctx.addIssue({
          code: 'custom',
          message:
            event.arrivalDate < request.departureDate
              ? `${event.place.name} is dated before the trip starts`
              : `${event.place.name} is dated before an earlier main event. Reorder them or change the dates.`,
          path: ['mainEvents', i, 'arrivalDate'],
        });
      }
      previous = event.arrivalDate;
    });
  });

export const stopKindSchema = z.enum(['activity', 'meal', 'lodging', 'destination', 'custom', 'event']);

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
  /** Lodging stops: the kind of lodging (it can differ from the trip default after a swap). */
  lodgingType: lodgingTypeSchema.optional(),
  /** Main event stops: the request's main event this stop is for. */
  eventId: z.string().max(64).optional(),
  durationMinutes: z.number().int().min(0).max(1440),
  pinnedStart: timeOfDaySchema.nullable().optional(),
  /** Arrive no later than this local time. */
  arriveBy: timeOfDaySchema.nullable().optional(),
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

/** Swap search: a category in an area. Without bounds, the area around the stop is used. */
export const swapSearchQuerySchema = z
  .object({
    category: z.string().trim().min(1).max(80).optional(),
    q: z.string().trim().max(80).optional(),
    south: z.coerce.number().min(-90).max(90).optional(),
    west: z.coerce.number().min(-180).max(180).optional(),
    north: z.coerce.number().min(-90).max(90).optional(),
    east: z.coerce.number().min(-180).max(180).optional(),
    pageToken: z.string().max(2000).optional(),
  })
  .refine((v) => [v.south, v.west, v.north, v.east].every((x) => x === undefined) || [v.south, v.west, v.north, v.east].every((x) => x !== undefined), {
    message: 'Provide all of south, west, north and east, or none',
  });

export const autocompleteQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  session: z.string().max(100).optional(),
});

export type LatLng = z.infer<typeof latLngSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export type SwapSearchQuery = z.infer<typeof swapSearchQuerySchema>;
export type OpeningPeriod = z.infer<typeof openingPeriodSchema>;
export type PlaceInfo = z.infer<typeof placeInfoSchema>;
export type LodgingType = z.infer<typeof lodgingTypeSchema>;
export type MealType = z.infer<typeof mealTypeSchema>;
export type Pace = z.infer<typeof paceSchema>;
export type ActivityFrequency = z.infer<typeof activityFrequencySchema>;
export type ActivityPriority = z.infer<typeof activityPrioritySchema>;
export type ActivityRequest = z.infer<typeof activityRequestSchema>;
export type TripPreferences = z.infer<typeof tripPreferencesSchema>;
export type StayUnit = z.infer<typeof stayUnitSchema>;
export type MainEvent = z.infer<typeof mainEventSchema>;
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
