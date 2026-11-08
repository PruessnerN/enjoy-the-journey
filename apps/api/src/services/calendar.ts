import type { Stop, Trip } from '@journey/shared';

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function formatUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Folds content lines to 75 octets as required by RFC 5545. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 75) {
      out.push(current);
      current = ` ${ch}`;
      bytes = 1 + size;
    } else {
      current += ch;
      bytes += size;
    }
  }
  out.push(current);
  return out.join('\r\n');
}

function eventFor(trip: Trip, stop: Stop, dayNumber: number): string[] | null {
  const isEnd = stop.kind === 'lodging' || stop.kind === 'destination';
  const start = isEnd ? stop.arrival : stop.start;
  // Arrivals (and arriving at a main event for the night) get a short calendar slot.
  const end = isEnd || stop.departure === stop.start ? new Date(new Date(start).getTime() + 30 * 60_000).toISOString() : stop.departure;
  const label =
    stop.kind === 'lodging'
      ? `Check in: ${stop.place.name}`
      : stop.kind === 'destination'
        ? `Arrive: ${stop.place.name}`
        : stop.kind === 'event'
          ? `Main event: ${stop.place.name}`
          : stop.place.name;
  const prefix = stop.activityLabel && !isEnd && stop.kind !== 'event' ? `${stop.activityLabel} · ` : '';
  const description = [
    `Day ${dayNumber} of ${trip.name}`,
    stop.place.rating ? `Rated ${stop.place.rating} (${stop.place.userRatingCount ?? 0} reviews)` : '',
    stop.notes ?? '',
    ...(stop.links ?? []).map((l) => `${l.label}: ${l.url}`),
  ]
    .filter(Boolean)
    .join('\n');

  return [
    'BEGIN:VEVENT',
    `UID:${stop.id}@enjoy-the-journey`,
    `DTSTAMP:${formatUtc(trip.updatedAt)}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeText(`${stop.emoji ? `${stop.emoji} ` : ''}${prefix}${label}`)}`,
    ...(stop.place.address ? [`LOCATION:${escapeText(stop.place.address)}`] : []),
    `GEO:${stop.place.location.lat.toFixed(6)};${stop.place.location.lng.toFixed(6)}`,
    `DESCRIPTION:${escapeText(description)}`,
    ...(stop.place.googleMapsUri ? [`URL:${stop.place.googleMapsUri}`] : []),
    'END:VEVENT',
  ];
}

/** An iCalendar file with every stop, so the itinerary can live in the travellers' calendars. */
export function buildCalendar(trip: Trip): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Enjoy the Journey//Trip Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(trip.name)}`,
    ...trip.days.flatMap((day) =>
      day.stops
        // On free days at a main event, the lodging is the one already checked into.
        .filter((stop) => !(day.stay && stop.kind === 'lodging'))
        .flatMap((stop) => eventFor(trip, stop, day.index + 1) ?? []),
    ),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
