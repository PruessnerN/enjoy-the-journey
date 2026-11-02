import { decodePolyline, type LatLng, type Trip } from '@journey/shared';
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
  kind: 'start' | 'stop' | 'lodging' | 'destination';
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
    day.legs.forEach((leg, i) => {
      const from = i === 0 ? day.start.location : day.stops[i - 1]!.place.location;
      const to = day.stops[i]!.place.location;
      const points = leg.polyline ? decodePolyline(leg.polyline) : [from, to];
      paths.push({ key: `${day.index}-${i}`, dayIndex: day.index, color, points: points.length > 1 ? points : [from, to] });
    });
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
    day.stops.forEach((stop, i) => {
      const isEnd = stop.kind === 'lodging' || stop.kind === 'destination';
      if (selectedDay === null && !isEnd) return;
      markers.push({
        key: stop.id,
        dayIndex: day.index,
        stopId: stop.id,
        position: stop.place.location,
        label: selectedDay === null ? '' : String(i + 1),
        emoji: stopIcon(stop),
        title: `${formatTime(isEnd ? stop.arrival : stop.start, stop.timeZone)} · ${stop.place.name}`,
        kind: stop.kind === 'lodging' ? 'lodging' : stop.kind === 'destination' ? 'destination' : 'stop',
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
    bounds: {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    },
  };
}
