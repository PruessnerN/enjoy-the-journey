import { useMemo } from 'react';
import type { LatLng } from '@journey/shared';
import type { MapModel } from './mapModel';

interface SchematicMapProps {
  model: MapModel;
  selectedDay: number | null;
  focusedStopId: string | null;
  onSelectStop: (dayIndex: number, stopId: string) => void;
}

const WIDTH = 600;
const PAD = 40;

/**
 * A lightweight SVG rendering of the route, used when no Google Maps browser key is configured.
 * It is a schematic (no base map), but keeps the shape of each day and where stops fall.
 */
export function SchematicMap({ model, selectedDay, focusedStopId, onSelectStop }: SchematicMapProps) {
  const { project, height } = useMemo(() => {
    const { north, south, east, west } = model.bounds;
    const midLat = ((north + south) / 2) * (Math.PI / 180);
    const spanX = Math.max(0.01, (east - west) * Math.cos(midLat));
    const spanY = Math.max(0.01, north - south);
    const scale = (WIDTH - PAD * 2) / Math.max(spanX, spanY * 1.1);
    const h = Math.max(320, Math.min(900, spanY * scale + PAD * 2));
    const offsetX = (WIDTH - spanX * scale) / 2;
    const offsetY = (h - spanY * scale) / 2;
    return {
      height: h,
      project: (p: LatLng): [number, number] => [offsetX + (p.lng - west) * Math.cos(midLat) * scale, offsetY + (north - p.lat) * scale],
    };
  }, [model.bounds]);

  const toPath = (points: LatLng[]) =>
    points.map((p, i) => {
      const [x, y] = project(p);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

  return (
    <div className="schematic-map">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Route map">
        {model.paths.map((p) => {
          const active = selectedDay === null || p.dayIndex === selectedDay;
          return (
            <path
              key={p.key}
              d={toPath(p.points)}
              fill="none"
              stroke={p.color}
              strokeWidth={active ? 6 : 3}
              strokeOpacity={active ? 0.9 : 0.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {model.markers.map((m) => {
          const [x, y] = project(m.position);
          const big = m.kind !== 'stop';
          const focused = m.stopId !== null && m.stopId === focusedStopId;
          return (
            <g
              key={m.key}
              transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
              className="schematic-map__marker"
              onClick={() => m.stopId && onSelectStop(m.dayIndex, m.stopId)}
              role={m.stopId ? 'button' : undefined}
              tabIndex={m.stopId ? 0 : undefined}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && m.stopId) onSelectStop(m.dayIndex, m.stopId);
              }}
            >
              <title>{m.title}</title>
              <circle className="schematic-map__pin" r={focused ? 26 : big ? 22 : 18} stroke={m.color} strokeWidth={focused ? 6 : 4} />
              <text textAnchor="middle" dominantBaseline="central" fontSize={big ? 22 : 18}>
                {m.emoji}
              </text>
              {m.label && (
                <g transform="translate(16,-16)">
                  <circle r="11" fill={m.color} />
                  <text className="schematic-map__label" textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700">
                    {m.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <p className="schematic-map__note">Schematic view · add a Google Maps browser key for the full interactive map</p>
    </div>
  );
}
