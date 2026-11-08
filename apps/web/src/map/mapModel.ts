import { decodePolyline, type Bounds, type LatLng, type Trip, type TripDay } from '@journey/shared';
import { STOP_ICONS, dayStartIconKind, stopIcon } from '../trip/stopIcons';
import { formatTime } from '../lib/time';
import type { Theme } from '../lib/theme';
import { dayColor } from './colors';

export interface MapMarker {
  key: string;
  dayIndex: number;
  stopId: string | null;
  position: LatLng;
  label: string;
  emoji: string;
  title: string;
  kind: 'start' | 'stop' | 'lodging' | 'destination' | 'event';
  color: string;
}

export interface MapPath {
  key: string;
  dayIndex: number;
  color: string;
  points: LatLng[];
}

export interface MapModel {
  markers: MapMarker[];
  paths: MapPath[];
  bounds: { north: number; south: number; east: number; west: number };
}

/** Flattens a trip into markers and route paths for whichever map renderer is in use. */
export function buildMapModel(trip: Trip, selectedDay: number | null, theme: Theme): MapModel {
  const markers: MapMarker[] = [];
  const paths: MapPath[] = [];
  const visibleDays = selectedDay === null ? trip.days : trip.days.filter((d) => d.index === selectedDay);

  for (const day of trip.days) {
    const color = dayColor(day.index, theme);
    dayRoutePaths(day).forEach((points, i) => paths.push({ key: `${day.index}-${i}`, dayIndex: day.index, color, points }));
  }

  if (trip.days[0]) {
    const first = trip.days[0];
    markers.push({
      key: 'origin',
      dayIndex: 0,
      stopId: null,
      position: first.start.location,
      label: '',
      emoji: STOP_ICONS.driving.emoji,
      title: `Start: ${first.start.name}`,
      kind: 'start',
      color: dayColor(0, theme),
    });
  }

  if (selectedDay !== null && selectedDay > 0 && trip.days[selectedDay]) {
    const day = trip.days[selectedDay];
    markers.push({
      key: `start-${day.index}`,
      dayIndex: day.index,
      stopId: null,
      position: day.start.location,
      label: '',
      emoji: STOP_ICONS[dayStartIconKind(day.index)].emoji,
      title: `Day ${day.index + 1} starts: ${day.start.name}`,
      kind: 'start',
      color: dayColor(day.index, theme),
    });
  }

  for (const day of visibleDays) {
    // Free days at a main event repeat the same lodging; the whole-trip map shows it once.
    if (selectedDay === null && day.stay) continue;
    day.stops.forEach((stop, i) => {
      const isEnd = stop.kind === 'lodging' || stop.kind === 'destination';
      if (selectedDay === null && !isEnd && stop.kind !== 'event') return;
      markers.push({
        key: stop.id,
        dayIndex: day.index,
        stopId: stop.id,
        position: stop.place.location,
        label: selectedDay === null ? '' : String(i + 1),
        emoji: stopIcon(stop),
        title: `${formatTime(isEnd ? stop.arrival : stop.start, stop.timeZone)} · ${stop.place.name}`,
        kind: stop.kind === 'lodging' ? 'lodging' : stop.kind === 'destination' ? 'destination' : stop.kind === 'event' ? 'event' : 'stop',
        color: dayColor(day.index, theme),
      });
    });
  }

  const boundsPoints = [
    ...paths.filter((p) => selectedDay === null || p.dayIndex === selectedDay).flatMap((p) => p.points),
    ...markers.filter((m) => selectedDay === null || m.dayIndex === selectedDay).map((m) => m.position),
  ];
  if (selectedDay !== null && trip.days[selectedDay]) boundsPoints.push(trip.days[selectedDay].start.location);
  const lats = boundsPoints.map((p) => p.lat);
  const lngs = boundsPoints.map((p) => p.lng);
  return {
    markers,
    paths,
    bounds: withMinimumSpan({
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    }),
  };
}

/** Keeps a day spent in one place (a free day at a main event) from zooming in to street level. */
export function withMinimumSpan(bounds: Bounds, minLat = 0.08, minLng = 0.12): Bounds {
  const padLat = Math.max(0, (minLat - (bounds.north - bounds.south)) / 2);
  const padLng = Math.max(0, (minLng - (bounds.east - bounds.west)) / 2);
  return { north: bounds.north + padLat, south: bounds.south - padLat, east: bounds.east + padLng, west: bounds.west - padLng };
}

/** The day's drive as one path per leg (straight lines where a leg has no geometry). */
export function dayRoutePaths(day: TripDay): LatLng[][] {
  return day.legs.map((leg, i) => {
    const from = i === 0 ? day.start.location : day.stops[i - 1]!.place.location;
    const to = day.stops[i]!.place.location;
    const points = leg.polyline ? decodePolyline(leg.polyline) : [];
    return points.length > 1 ? points : [from, to];
  });
}

/** True when the visible map area has moved or zoomed noticeably compared to `baseline`. */
export function viewMoved(view: Bounds, baseline: Bounds): boolean {
  const latSpan = baseline.north - baseline.south;
  const lngSpan = baseline.east - baseline.west;
  const dLat = Math.abs((view.north + view.south) / 2 - (baseline.north + baseline.south) / 2);
  const dLng = Math.abs((view.east + view.west) / 2 - (baseline.east + baseline.west) / 2);
  const zoom = (view.north - view.south) / latSpan;
  return dLat > latSpan * 0.12 || dLng > lngSpan * 0.12 || zoom < 0.8 || zoom > 1.25;
}
