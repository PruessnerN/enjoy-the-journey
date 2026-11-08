import { lazy, Suspense } from 'react';
import type { Bounds, LatLng } from '@journey/shared';
import { useConfig } from '../api/hooks';
import { useTheme } from '../components/ThemeProvider';
import { Spinner } from '../components/ui';
import { ZoomableSchematicMap } from './ZoomableSchematicMap';

const GoogleAreaMap = lazy(() => import('./GoogleAreaMap').then((m) => ({ default: m.GoogleAreaMap })));

export interface AreaMapMarker {
  id: string;
  position: LatLng;
  emoji: string;
  /** Small badge, e.g. the result number. */
  badge?: string;
  title: string;
  variant: 'current' | 'result';
}

export interface AreaMapProps {
  /** Area to show when the map first appears. */
  initialArea: Bounds;
  routePaths: LatLng[][];
  markers: AreaMapMarker[];
  activeId: string | null;
  /** Pan to this marker if it is off screen (set when a result is clicked in the list). */
  panToId?: string | null;
  onSelect: (id: string) => void;
  /** Called with the visible area initially and as the map pans or zooms. */
  onViewChange: (view: Bounds) => void;
}

/** A pannable, zoomable map of an area: Google Maps when a browser key is configured, else a schematic. */
export function AreaMap(props: AreaMapProps) {
  const config = useConfig();
  const { theme } = useTheme();
  const key = config.data?.mapsBrowserKey;
  if (config.isLoading) return <Spinner />;
  if (key) {
    return (
      <Suspense fallback={<Spinner label="Loading map…" />}>
        <GoogleAreaMap {...props} apiKey={key} mapId={config.data?.mapId ?? null} theme={theme} />
      </Suspense>
    );
  }
  return <ZoomableSchematicMap {...props} />;
}
