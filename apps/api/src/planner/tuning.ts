import type { ActivityFrequency, Pace } from '@journey/shared';

/**
 * Every knob the planner uses, in one place. Tweak these to change how the
 * itinerary "feels" without touching the algorithm itself.
 */
export const TUNING = {
  /** Fuel/restroom breaks folded into long drives. */
  restBreaks: {
    everyDrivingMinutes: 150,
    breakMinutes: 15,
  },

  /** How long a detour off the main route takes (we drive there and back). */
  detour: {
    /** Real roads are longer than straight lines. */
    roadFactor: 1.3,
    /** Average speed on the roads leading to a stop. */
    offRouteSpeedKmh: 60,
    /** Exiting the highway, parking, walking in. */
    overheadMinutes: 4,
  },

  /** Rating quality: a Bayesian average that pulls low-review places toward the prior. */
  quality: {
    priorMean: 4.0,
    priorWeight: 15,
    minReviewCount: 3,
  },

  /** Activity scoring weights. Higher score = picked first. */
  scoring: {
    qualityWeight: 2.2,
    popularityWeight: 0.25,
    detourPenaltyPerHour: 3.5,
    highPriorityBonus: 2.5,
    unratedPenalty: 1.5,
    /**
     * Spread stops along the drive instead of clustering them in the biggest town (usually the
     * start). A candidate earns this many points per hour of driving between it and the nearest
     * other stop (or the day's start/end), capped at `spreadMaxHours`.
     */
    spreadBonusPerHour: 3,
    spreadMaxHours: 1.5,
    /** How many of the best candidates per activity are tried before giving up. */
    candidatesToTry: 8,
  },

  meals: {
    maxDetourMinutes: 20,
    /** How far (drive time) a restaurant may be from where we'd ideally eat. */
    maxRouteOffsetMinutes: 30,
    routeOffsetPenaltyPerHour: 4,
    /** Restaurants are searched along the route in chunks of this many minutes. */
    searchSegmentMinutes: 90,
  },

  lodging: {
    /** Search window around the overnight target, as a fraction of that day's drive. */
    windowBeforeFraction: 0.2,
    windowAfterFraction: 0.1,
    minWindowMinutes: 20,
    maxWindowBeforeMinutes: 75,
    maxWindowAfterMinutes: 40,
    /** Penalty for stopping earlier/later than the even split of driving. */
    deviationPenaltyPerHour: 2.5,
    detourPenaltyPerHour: 3,
    /** Lodging may be further off-route than activities. */
    minDetourAllowanceMinutes: 30,
    /** If nothing meets the minimum rating we relax it by this much (a bed beats no bed). */
    ratingRelaxation: 0.5,
  },

  schedule: {
    maxWaitForOpeningMinutes: 60,
    /** While planning, don't schedule a stop that would mean waiting longer than this for it to open. */
    planningMaxOpeningWaitMinutes: 20,
    maxWaitForMealMinutes: 90,
    /** Waits at least this long are pointed out to the user as free time. */
    freeTimeNoticeMinutes: 30,
    closingToleranceMinutes: 10,
    daylightToleranceMinutes: 10,
    /** With "avoid night driving", arrive no later than sunset + this. */
    nightDrivingGraceMinutes: 30,
    lateArrivalToleranceMinutes: 5,
    /**
     * While planning, aim to finish this much earlier than the hard limits (arrive-by,
     * sunset). Planning uses estimated drive times; this absorbs the estimation error.
     */
    planningSafetyMinutes: 20,
    longDriveToleranceFactor: 1.15,
  },

  dayCount: {
    /** Extra time for breaks/detours when estimating how many days the drive needs. */
    driveOverheadFactor: 1.08,
    /** Minimum time reserved for fun each day, by pace. */
    minFunMinutes: { relaxed: 240, balanced: 150, efficient: 60 } satisfies Record<Pace, number>,
    maxDays: 21,
  },

  candidates: {
    /** Activity searches are split into chunks of this many minutes along the day's route. */
    segmentMaxMinutes: 210,
    maxResultsPerSearch: 20,
  },

  frequency: {
    once: { perDay: 1, perTrip: 1 },
    few: { perDay: 1, perTrip: 3 },
    daily: { perDay: 1, perTrip: Number.POSITIVE_INFINITY },
    often: { perDay: 2, perTrip: Number.POSITIVE_INFINITY },
  } satisfies Record<ActivityFrequency, { perDay: number; perTrip: number }>,

  /**
   * "2–3 times this trip": about one every `everyNDays` days, at least `minTimes` (trip length
   * permitting) and at most `frequency.few.perTrip`, spread evenly across the trip.
   */
  fewTimes: {
    everyNDays: 2,
    minTimes: 2,
  },

  /**
   * After a day is routed for real, re-plan it if real drive times break it (late arrival, closed,
   * after dark), using the measured detours. Each round costs one extra routing call.
   */
  repair: {
    maxRounds: 3,
    /** A stop's detour is re-estimated when the real one is at least this much longer. */
    detourErrorThresholdMinutes: 5,
  },

  /** Greedy passes over the activity list (each pass can add one more of each activity). */
  maxFillPasses: 3,
} as const;
