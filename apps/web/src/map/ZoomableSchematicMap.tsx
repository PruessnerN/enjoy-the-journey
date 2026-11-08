import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Bounds, LatLng } from '@journey/shared';
import type { AreaMapProps } from './AreaMap';

/** Map center plus scale in pixels per degree of latitude (equirectangular, fine at road-trip scales). */
interface View {
  lat: number;
  lng: number;
  scale: number;
}

interface Size {
  w: number;
  h: number;
}

const MIN_SCALE = 3;
const MAX_SCALE = 150_000;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const cosLat = (lat: number) => Math.max(0.05, Math.cos((lat * Math.PI) / 180));

/** Pill width that fits a badge label ("3", "12", "Now"). */
const badgeWidth = (label: string) => Math.max(18, label.length * 7 + 6);

function fit(area: Bounds, { w, h }: Size): View {
  const lat = (area.north + area.south) / 2;
  const scale = Math.min(h / (area.north - area.south), w / ((area.east - area.west) * cosLat(lat)));
  return { lat, lng: (area.east + area.west) / 2, scale: clampScale(scale) };
}

function visibleBounds(v: View, { w, h }: Size): Bounds {
  const dLat = h / 2 / v.scale;
  const dLng = w / 2 / (v.scale * cosLat(v.lat));
  return { south: v.lat - dLat, north: v.lat + dLat, west: v.lng - dLng, east: v.lng + dLng };
}

/** Zooms by `factor` keeping the point under (x, y) fixed. */
function zoomAt(v: View, x: number, y: number, factor: number, { w, h }: Size): View {
  const lat = v.lat - (y - h / 2) / v.scale;
  const lng = v.lng + (x - w / 2) / (v.scale * cosLat(v.lat));
  const scale = clampScale(v.scale * factor);
  const centerLat = Math.max(-85, Math.min(85, lat + (y - h / 2) / scale));
  return { lat: centerLat, lng: lng - (x - w / 2) / (scale * cosLat(centerLat)), scale };
}

/** A pannable, zoomable schematic map (no base tiles) for setups without a Google Maps browser key. */
export function ZoomableSchematicMap({ initialArea, routePaths, markers, activeId, onSelect, onViewChange }: AreaMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<View | null>(null);
  const sizeRef = useRef<Size | null>(null);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = { w: entry.contentRect.width, h: entry.contentRect.height };
      sizeRef.current = next;
      setSize(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (size && size.w > 0 && size.h > 0 && !view) setView(fit(initialArea, size));
  }, [size, view, initialArea]);

  useEffect(() => {
    if (!view || !size) return;
    onViewChangeRef.current(visibleBounds(view, size));
  }, [view, size]);

  // React's wheel listener is passive, so register our own to stop the dialog from scrolling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = sizeRef.current;
      if (!s) return;
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView((v) => (v ? zoomAt(v, e.clientX - rect.left, e.clientY - rect.top, factor, s) : v));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomButton = (factor: number) => {
    const s = sizeRef.current;
    if (s) setView((v) => (v ? zoomAt(v, s.w / 2, s.h / 2, factor, s) : v));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!view || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const lat = Math.max(-85, Math.min(85, d.view.lat + dy / d.view.scale));
    setView({ ...d.view, lat, lng: d.view.lng - dx / (d.view.scale * cosLat(d.view.lat)) });
  };
  const endDrag = () => {
    drag.current = null;
  };

  const project = (p: LatLng): [number, number] => {
    if (!view || !size) return [0, 0];
    return [size.w / 2 + (p.lng - view.lng) * view.scale * cosLat(view.lat), size.h / 2 - (p.lat - view.lat) * view.scale];
  };

  return (
    <div
      ref={ref}
      className="schematic-map schematic-map--zoomable"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {view && size && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label="Search area map">
          {routePaths.map((path, i) => (
            <path
              key={i}
              d={path.map((p, k) => `${k === 0 ? 'M' : 'L'}${project(p).map((n) => n.toFixed(1)).join(',')}`).join(' ')}
              className="schematic-map__route"
              fill="none"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {[...markers]
            .sort((a, b) => Number(a.id === activeId) - Number(b.id === activeId))
            .map((m) => {
              const [x, y] = project(m.position);
              const active = m.id === activeId;
              const r = active ? 19 : m.variant === 'current' ? 17 : 14;
              return (
                <g
                  key={m.id}
                  transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
                  className={`schematic-map__marker schematic-map__marker--${m.variant}${active ? ' is-active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onSelect(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelect(m.id);
                  }}
                >
                  <title>{m.title}</title>
                  <circle className="schematic-map__pin" r={r} strokeWidth={active ? 4 : 3} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={r}>
                    {m.emoji}
                  </text>
                  {m.badge && (
                    <g transform={`translate(${r - 2},${-(r - 2)})`}>
                      <rect className="schematic-map__badge" x={-badgeWidth(m.badge) / 2} y={-9} width={badgeWidth(m.badge)} height={18} rx={9} />
                      <text className="schematic-map__label" textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="700">
                        {m.badge}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
        </svg>
      )}
      <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Zoom in" onClick={() => zoomButton(1.5)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomButton(1 / 1.5)}>
          −
        </button>
      </div>
    </div>
  );
}
