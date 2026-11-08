import { useEffect } from 'react';
import { AdvancedMarker, APIProvider, ColorScheme, Map, Polyline, useMap } from '@vis.gl/react-google-maps';
import type { Theme } from '../lib/theme';
import type { AreaMapProps } from './AreaMap';

interface GoogleAreaMapProps extends AreaMapProps {
  apiKey: string;
  mapId: string | null;
  theme: Theme;
}

/** Brings a marker chosen from the list into view. */
function PanTo({ markers, panToId }: Pick<AreaMapProps, 'markers' | 'panToId'>) {
  const map = useMap();
  useEffect(() => {
    const marker = markers.find((m) => m.id === panToId);
    const bounds = map?.getBounds();
    if (map && marker && bounds && !bounds.contains(marker.position)) map.panTo(marker.position);
    // Only react to a new request, not to marker list changes.
  }, [map, panToId]);
  return null;
}

export function GoogleAreaMap({ apiKey, mapId, theme, initialArea, routePaths, markers, activeId, panToId, onSelect, onViewChange }: GoogleAreaMapProps) {
  return (
    <APIProvider apiKey={apiKey}>
      <Map
        // The color scheme can only be set when the map is created, so remount on theme change.
        key={theme}
        colorScheme={theme === 'dark' ? ColorScheme.DARK : ColorScheme.LIGHT}
        className="google-map"
        defaultBounds={{ ...initialArea, padding: 0 }}
        mapId={mapId ?? 'DEMO_MAP_ID'}
        gestureHandling="greedy"
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
        onBoundsChanged={(e) => {
          const bounds = e.map.getBounds();
          if (bounds) onViewChange(bounds.toJSON());
        }}
      >
        <PanTo markers={markers} panToId={panToId} />
        {routePaths.map((path, i) => (
          <Polyline key={i} path={path} strokeColor={theme === 'dark' ? '#e07a52' : '#c4562d'} strokeOpacity={0.55} strokeWeight={4} />
        ))}
        {markers.map((m) => {
          const active = m.id === activeId;
          return (
            <AdvancedMarker
              key={m.id}
              position={m.position}
              title={m.title}
              zIndex={active ? 1000 : m.variant === 'current' ? 500 : 10}
              onClick={() => onSelect(m.id)}
            >
              <div className={`map-pin map-pin--${m.variant}${active ? ' is-focused' : ''}`}>
                <span aria-hidden>{m.emoji}</span>
                {m.badge && <small>{m.badge}</small>}
              </div>
            </AdvancedMarker>
          );
        })}
      </Map>
    </APIProvider>
  );
}
