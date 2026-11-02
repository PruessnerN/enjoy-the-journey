import { decodePolyline, encodePolyline, type LatLng } from '@journey/shared';
import { haversineMeters, interpolate, projectOntoSegment, simplifyToMaxPoints } from './geo.js';

export interface ProfileStep {
  durationSeconds: number;
  distanceMeters: number;
  polyline: string;
}

export interface RouteProjection {
  /** Drive time (seconds) from the start of the route to the closest point on it. */
  seconds: number;
  /** Straight-line distance from the place to the route. */
  offRouteMeters: number;
  point: LatLng;
}

const CHUNK_SIZE = 64;

interface Chunk {
  start: number;
  end: number;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * A route geometry annotated with cumulative drive time and distance, so the planner
 * can ask "where will we be after 3h15m of driving?" and "how far along the drive is this place?".
 */
export class RouteProfile {
  readonly points: LatLng[];
  readonly cumSeconds: Float64Array;
  readonly cumMeters: Float64Array;
  private readonly chunks: Chunk[];

  private constructor(points: LatLng[], cumSeconds: Float64Array, cumMeters: Float64Array) {
    this.points = points;
    this.cumSeconds = cumSeconds;
    this.cumMeters = cumMeters;
    this.chunks = buildChunks(points);
  }

  get totalSeconds(): number {
    return this.cumSeconds[this.cumSeconds.length - 1] ?? 0;
  }

  get totalMeters(): number {
    return this.cumMeters[this.cumMeters.length - 1] ?? 0;
  }

  /** Average speed in meters/second (used to estimate distances of synthetic legs). */
  get averageSpeed(): number {
    return this.totalSeconds > 0 ? this.totalMeters / this.totalSeconds : 25;
  }

  get start(): LatLng {
    return this.points[0]!;
  }

  get end(): LatLng {
    return this.points[this.points.length - 1]!;
  }

  /** Builds a profile from route steps, spreading each step's duration across its geometry by distance. */
  static fromSteps(steps: ProfileStep[]): RouteProfile {
    const points: LatLng[] = [];
    const secs: number[] = [];
    const meters: number[] = [];
    let accSeconds = 0;
    let accMeters = 0;

    for (const step of steps) {
      const geometry = decodePolyline(step.polyline);
      if (geometry.length < 2) {
        // Degenerate step: account for its time/distance at the current point.
        accSeconds += step.durationSeconds;
        accMeters += step.distanceMeters;
        if (geometry.length === 1 && points.length === 0) {
          points.push(geometry[0]!);
          secs.push(accSeconds);
          meters.push(accMeters);
        } else if (secs.length > 0) {
          secs[secs.length - 1] = accSeconds;
          meters[meters.length - 1] = accMeters;
        }
        continue;
      }
      const segLengths: number[] = [];
      let geomLength = 0;
      for (let i = 1; i < geometry.length; i++) {
        const d = haversineMeters(geometry[i - 1]!, geometry[i]!);
        segLengths.push(d);
        geomLength += d;
      }
      if (points.length === 0) {
        points.push(geometry[0]!);
        secs.push(accSeconds);
        meters.push(accMeters);
      }
      // geometry[0] duplicates the previous step's last point, so start at 1.
      const stepMeters = step.distanceMeters > 0 ? step.distanceMeters : geomLength;
      for (let i = 1; i < geometry.length; i++) {
        const fraction = geomLength > 0 ? segLengths[i - 1]! / geomLength : 1 / (geometry.length - 1);
        accSeconds += step.durationSeconds * fraction;
        accMeters += stepMeters * fraction;
        points.push(geometry[i]!);
        secs.push(accSeconds);
        meters.push(accMeters);
      }
    }
    if (points.length === 0) {
      throw new Error('Cannot build a route profile without geometry');
    }
    if (points.length === 1) {
      points.push(points[0]!);
      secs.push(accSeconds);
      meters.push(accMeters);
    }
    return new RouteProfile(points, Float64Array.from(secs), Float64Array.from(meters));
  }

  /** Builds a profile from a plain path, assuming constant speed. */
  static fromPath(path: LatLng[], totalSeconds: number, totalMeters?: number): RouteProfile {
    const geomMeters = path.slice(1).reduce((sum, p, i) => sum + haversineMeters(path[i]!, p), 0);
    return RouteProfile.fromSteps([
      { durationSeconds: totalSeconds, distanceMeters: totalMeters ?? geomMeters, polyline: encodePolyline(path) },
    ]);
  }

  private indexAtSeconds(seconds: number): number {
    const arr = this.cumSeconds;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid]! <= seconds) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  pointAtSeconds(seconds: number): LatLng {
    const s = clamp(seconds, 0, this.totalSeconds);
    const i = this.indexAtSeconds(s);
    if (i >= this.points.length - 1) return this.end;
    const t0 = this.cumSeconds[i]!;
    const t1 = this.cumSeconds[i + 1]!;
    const f = t1 > t0 ? (s - t0) / (t1 - t0) : 0;
    return interpolate(this.points[i]!, this.points[i + 1]!, f);
  }

  metersAtSeconds(seconds: number): number {
    const s = clamp(seconds, 0, this.totalSeconds);
    const i = this.indexAtSeconds(s);
    if (i >= this.points.length - 1) return this.totalMeters;
    const t0 = this.cumSeconds[i]!;
    const t1 = this.cumSeconds[i + 1]!;
    const f = t1 > t0 ? (s - t0) / (t1 - t0) : 0;
    return this.cumMeters[i]! + f * (this.cumMeters[i + 1]! - this.cumMeters[i]!);
  }

  /** The portion of the route between two drive times. */
  slice(fromSeconds: number, toSeconds: number): LatLng[] {
    const a = clamp(Math.min(fromSeconds, toSeconds), 0, this.totalSeconds);
    const b = clamp(Math.max(fromSeconds, toSeconds), 0, this.totalSeconds);
    const result: LatLng[] = [this.pointAtSeconds(a)];
    for (let i = this.indexAtSeconds(a) + 1; i < this.points.length && this.cumSeconds[i]! < b; i++) {
      result.push(this.points[i]!);
    }
    result.push(this.pointAtSeconds(b));
    return result;
  }

  /** Encoded polyline of a slice, simplified to keep request payloads small. */
  encodedSlice(fromSeconds: number, toSeconds: number, maxPoints = 250): string {
    return encodePolyline(simplifyToMaxPoints(this.slice(fromSeconds, toSeconds), maxPoints));
  }

  encoded(maxPoints = 400): string {
    return encodePolyline(simplifyToMaxPoints(this.points, maxPoints));
  }

  project(p: LatLng): RouteProjection {
    let bestDist = Infinity;
    let bestIndex = 0;
    let bestT = 0;
    const cosLat = Math.max(0.05, Math.cos((p.lat * Math.PI) / 180));

    // Visit chunks closest-first by bounding-box distance so the rest can be pruned.
    const ordered = this.chunks.map((chunk) => ({ chunk, d: bboxDistanceDeg(p, chunk) })).sort((x, y) => x.d - y.d);

    for (const { chunk } of ordered) {
      if (bestDist !== Infinity) {
        const slackLat = bestDist / 111_132;
        const slackLng = bestDist / (111_320 * cosLat);
        if (
          p.lat < chunk.minLat - slackLat ||
          p.lat > chunk.maxLat + slackLat ||
          p.lng < chunk.minLng - slackLng ||
          p.lng > chunk.maxLng + slackLng
        ) {
          continue;
        }
      }
      for (let i = chunk.start; i < chunk.end; i++) {
        const proj = projectOntoSegment(p, this.points[i]!, this.points[i + 1]!);
        if (proj.distanceMeters < bestDist) {
          bestDist = proj.distanceMeters;
          bestIndex = i;
          bestT = proj.t;
        }
      }
    }

    const s0 = this.cumSeconds[bestIndex]!;
    const s1 = this.cumSeconds[Math.min(bestIndex + 1, this.cumSeconds.length - 1)]!;
    const seconds = s0 + bestT * (s1 - s0);
    return {
      seconds,
      offRouteMeters: bestDist === Infinity ? haversineMeters(p, this.start) : bestDist,
      point: this.pointAtSeconds(seconds),
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function buildChunks(points: LatLng[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (let start = 0; start < points.length - 1; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, points.length - 1);
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (let i = start; i <= end; i++) {
      const pt = points[i]!;
      minLat = Math.min(minLat, pt.lat);
      maxLat = Math.max(maxLat, pt.lat);
      minLng = Math.min(minLng, pt.lng);
      maxLng = Math.max(maxLng, pt.lng);
    }
    chunks.push({ start, end, minLat, maxLat, minLng, maxLng });
  }
  return chunks;
}

function bboxDistanceDeg(p: LatLng, c: Chunk): number {
  const dLat = p.lat < c.minLat ? c.minLat - p.lat : p.lat > c.maxLat ? p.lat - c.maxLat : 0;
  const dLng = p.lng < c.minLng ? c.minLng - p.lng : p.lng > c.maxLng ? p.lng - c.maxLng : 0;
  return dLat * dLat + dLng * dLng;
}
