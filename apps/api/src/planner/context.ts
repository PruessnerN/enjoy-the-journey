import {
  addDaysToIsoDate,
  MEALS,
  parseTimeOfDay,
  type PlaceInfo,
  type TripRequest,
} from '@journey/shared';
import { epochToLocal, localTimeToEpoch, sunTimes, timeZoneAt } from '../geo/time.js';
import type { DayContext } from './schedule.js';
import { TUNING } from './tuning.js';

export function placeTimeZone(place: PlaceInfo): string {
  return place.timeZone ?? timeZoneAt(place.location);
}

export function withTimeZone(place: PlaceInfo): PlaceInfo {
  return place.timeZone ? place : { ...place, timeZone: timeZoneAt(place.location) };
}

export function buildDayContext(
  request: TripRequest,
  dayIndex: number,
  start: PlaceInfo,
  isFinalDay: boolean,
  startTime?: string,
): DayContext {
  const date = addDaysToIsoDate(request.departureDate, dayIndex);
  const timeZone = placeTimeZone(start);
  const time = startTime ?? request.preferences.dayStartTime;
  return {
    date,
    departure: localTimeToEpoch(date, parseTimeOfDay(time), timeZone),
    startTime: time,
    timeZone,
    arriveByTime: request.preferences.arriveByTime,
    avoidNightDriving: request.preferences.avoidNightDriving,
    maxDrivingHours: request.preferences.maxDrivingHoursPerDay,
    isFinalDay,
  };
}

/**
 * How many days should the drive take? Each day gets a driving budget equal to the
 * smaller of the user's comfort limit and whatever is left of the travel window after
 * meals and a minimum amount of fun.
 */
export function computeDayCount(totalDriveSeconds: number, request: TripRequest, origin: PlaceInfo): number {
  const prefs = request.preferences;
  if (prefs.fixedDays) return prefs.fixedDays;

  const startMin = parseTimeOfDay(prefs.dayStartTime);
  let endMin = parseTimeOfDay(prefs.arriveByTime);
  if (prefs.avoidNightDriving) {
    const tz = placeTimeZone(origin);
    const sun = sunTimes(request.departureDate, origin.location, tz);
    if (sun) {
      const sunsetMin = epochToLocal(sun.sunset, tz).minutes + TUNING.schedule.nightDrivingGraceMinutes;
      endMin = Math.min(endMin, sunsetMin);
    }
  }
  const windowMin = Math.max(120, endMin - startMin);
  const mealMin = (['breakfast', 'lunch', 'dinner'] as const)
    .filter((m) => prefs.meals[m])
    .filter((m) => {
      const meal = MEALS[m];
      return parseTimeOfDay(meal.windowEnd) > startMin && parseTimeOfDay(meal.windowStart) < endMin;
    })
    .reduce((sum, m) => sum + MEALS[m].durationMinutes, 0);
  const funMin = TUNING.dayCount.minFunMinutes[prefs.pace];
  const capacityMin = Math.max(90, Math.min(prefs.maxDrivingHoursPerDay * 60, windowMin - mealMin - funMin));
  const driveMin = (totalDriveSeconds / 60) * TUNING.dayCount.driveOverheadFactor;
  return Math.max(1, Math.ceil(driveMin / capacityMin));
}
