import { lazy, Suspense, useMemo } from 'react';
import type { Trip } from '@journey/shared';
import { useConfig } from '../api/hooks';
import { useTheme } from '../components/ThemeProvider';
import { Spinner } from '../components/ui';
import { buildMapModel } from './mapModel';
import { SchematicMap } from './SchematicMap';

// The Google Maps bundle is only loaded when a browser key is configured.
const GoogleTripMap = lazy(() => import('./GoogleTripMap').then((m) => ({ default: m.GoogleTripMap })));

interface TripMapProps {
  trip: Trip;
  selectedDay: number | null;
  focusedStopId: string | null;
  onSelectStop: (dayIndex: number, stopId: string) => void;
}

export function TripMap({ trip, selectedDay, focusedStopId, onSelectStop }: TripMapProps) {
  const config = useConfig();
  const { theme } = useTheme();
  const model = useMemo(() => buildMapModel(trip, selectedDay, theme), [trip, selectedDay, theme]);
  const key = config.data?.mapsBrowserKey;

  if (config.isLoading) return <Spinner />;
  if (key) {
    return (
      <Suspense fallback={<Spinner label="Loading map…" />}>
        <GoogleTripMap
          apiKey={key}
          mapId={config.data?.mapId ?? null}
          theme={theme}
          model={model}
          selectedDay={selectedDay}
          focusedStopId={focusedStopId}
          onSelectStop={onSelectStop}
        />
      </Suspense>
    );
  }
  return <SchematicMap model={model} selectedDay={selectedDay} focusedStopId={focusedStopId} onSelectStop={onSelectStop} />;
}
