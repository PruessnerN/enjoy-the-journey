import { useEffect } from 'react';
import { AdvancedMarker, APIProvider, ColorScheme, Map, Polyline, useMap } from '@vis.gl/react-google-maps';
import type { Theme } from '../lib/theme';
import type { MapModel } from './mapModel';

interface GoogleTripMapProps {
  apiKey: string;
  mapId: string | null;
  theme: Theme;
  model: MapModel;
  selectedDay: number | null;
  focusedStopId: string | null;
  onSelectStop: (dayIndex: number, stopId: string) => void;
}

function FitBounds({ bounds }: { bounds: MapModel['bounds'] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !Number.isFinite(bounds.north)) return;
    map.fitBounds(bounds, 48);
  }, [map, bounds.north, bounds.south, bounds.east, bounds.west]);
  return null;
}

export function GoogleTripMap({ apiKey, mapId, theme, model, selectedDay, focusedStopId, onSelectStop }: GoogleTripMapProps) {
  return (
    <APIProvider apiKey={apiKey}>
      <Map
        // The color scheme can only be set when the map is created, so remount on theme change.
        key={theme}
        colorScheme={theme === 'dark' ? ColorScheme.DARK : ColorScheme.LIGHT}
        className="google-map"
        defaultBounds={model.bounds}
        mapId={mapId ?? 'DEMO_MAP_ID'}
        gestureHandling="cooperative"
        streetViewControl={false}
        mapTypeControl={false}
      >
        <FitBounds bounds={model.bounds} />
        {model.paths.map((p) => {
          const active = selectedDay === null || p.dayIndex === selectedDay;
          return (
            <Polyline
              key={p.key}
              path={p.points}
              strokeColor={p.color}
              strokeOpacity={active ? 0.9 : 0.25}
              strokeWeight={active ? 5 : 3}
            />
          );
        })}
        {model.markers.map((m) => (
          <AdvancedMarker
            key={m.key}
            position={m.position}
            title={m.title}
            zIndex={m.stopId === focusedStopId ? 1000 : m.kind === 'stop' ? 10 : 20}
            onClick={() => m.stopId && onSelectStop(m.dayIndex, m.stopId)}
          >
            <div
              className={`map-pin map-pin--${m.kind}${m.stopId === focusedStopId ? ' is-focused' : ''}`}
              style={{ borderColor: m.color }}
            >
              <span aria-hidden>{m.emoji}</span>
              {m.label && (
                <small style={{ background: m.color }}>{m.label}</small>
              )}
            </div>
          </AdvancedMarker>
        ))}
      </Map>
    </APIProvider>
  );
}
