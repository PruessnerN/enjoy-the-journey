import type { LatLng } from '@journey/shared';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function interpolate(a: LatLng, b: LatLng, fraction: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction };
}

/** Moves `distanceMeters` from `origin` along `bearingDeg` (0 = north). */
export function destinationPoint(origin: LatLng, bearingDeg: number, distanceMeters: number): LatLng {
  const angular = distanceMeters / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lng2 =
    lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export interface SegmentProjection {
  /** 0..1 position along the segment. */
  t: number;
  distanceMeters: number;
}

/**
 * Projects `p` onto segment a→b using a local equirectangular approximation,
 * which is accurate to well under 1% at road-trip scales.
 */
export function projectOntoSegment(p: LatLng, a: LatLng, b: LatLng): SegmentProjection {
  const cosLat = Math.cos(toRad(p.lat));
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * cosLat;
  const ax = (a.lng - p.lng) * mPerDegLng;
  const ay = (a.lat - p.lat) * mPerDegLat;
  const bx = (b.lng - p.lng) * mPerDegLng;
  const by = (b.lat - p.lat) * mPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : -(ax * dx + ay * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { t, distanceMeters: Math.sqrt(cx * cx + cy * cy) };
}

/** Douglas-Peucker simplification with a tolerance in meters. */
export function simplifyPath(points: LatLng[], toleranceMeters: number): LatLng[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    const a = points[first]!;
    const b = points[last]!;
    for (let i = first + 1; i < last; i++) {
      const d = projectOntoSegment(points[i]!, a, b).distanceMeters;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceMeters) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Simplifies a path until it has at most `maxPoints` points. */
export function simplifyToMaxPoints(points: LatLng[], maxPoints: number, initialToleranceMeters = 15): LatLng[] {
  if (points.length <= maxPoints) return points.slice();
  let tolerance = initialToleranceMeters;
  let result = simplifyPath(points, tolerance);
  while (result.length > maxPoints && tolerance < 50_000) {
    tolerance *= 2;
    result = simplifyPath(points, tolerance);
  }
  return result;
}
