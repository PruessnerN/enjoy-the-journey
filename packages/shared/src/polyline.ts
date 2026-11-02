import type { LatLng } from './schemas.js';

/**
 * Encoded polyline algorithm (precision 5), compatible with Google Maps.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readValue();
    lng += readValue();
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

export function encodePolyline(points: LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLng = 0;
  let output = '';

  const writeValue = (value: number): void => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    output += String.fromCharCode(v + 63);
  };

  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    writeValue(lat - prevLat);
    writeValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return output;
}
