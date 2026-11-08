import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  defaultSearchCategory,
  searchCategoriesFor,
  swapGroupFor,
  type Bounds,
  type PlaceCandidate,
  type SearchCategory,
  type Stop,
  type StopInput,
  type SwapGroup,
  type Trip,
  type TripDay,
} from '@journey/shared';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { ErrorNote, Spinner } from '../components/ui';
import { AreaMap, type AreaMapMarker } from '../map/AreaMap';
import { dayRoutePaths, viewMoved } from '../map/mapModel';
import { CandidateList, candidateKey } from './CandidateList';
import { STOP_ICONS, stopIconKind } from './stopIcons';
import { swappedStop } from './swapStop';

interface SwapStopModalProps {
  trip: Trip;
  day: TripDay;
  stop: Stop;
  onChoose: (stop: StopInput) => void;
  onClose: () => void;
}

const CURRENT_ID = 'current-stop';
/** Must match the API's `TUNING.swap.maxAreaSpanDegrees`. */
const MAX_AREA_SPAN = { lat: 8, lng: 12 };
const RESULT_ICON: Record<SwapGroup, string> = {
  activity: STOP_ICONS.activity.emoji,
  meal: STOP_ICONS.meal.emoji,
  lodging: STOP_ICONS.lodging.emoji,
};
const KEYWORD_HINT: Record<SwapGroup, string> = {
  activity: 'Narrow it down (optional): a name, "9-hole", "rentals"…',
  meal: 'Narrow it down (optional): Thai, kid-friendly, a place name…',
  lodging: 'Narrow it down (optional): pool, pet-friendly, a place name…',
};

function sectionsOf(categories: SearchCategory[]): [string, SearchCategory[]][] {
  const sections = new Map<string, SearchCategory[]>();
  for (const c of categories) sections.set(c.section, [...(sections.get(c.section) ?? []), c]);
  return [...sections];
}

const tooBig = (b: Bounds) => b.north - b.south > MAX_AREA_SPAN.lat || b.east - b.west > MAX_AREA_SPAN.lng;

/**
 * Swap a stop for something else nearby. The search stays within the stop's group (activities,
 * places to eat or places to stay) and within the area shown on the map.
 */
export function SwapStopModal({ trip, day, stop, onChoose, onClose }: SwapStopModalProps) {
  const group = swapGroupFor(stop.kind) ?? 'activity';
  const categories = useMemo(() => searchCategoriesFor(group, trip.request.activities), [group, trip.request.activities]);
  const [categoryId, setCategoryId] = useState(
    () => defaultSearchCategory(stop, trip.request.activities, trip.request.lodgingType) ?? categories[0]!.id,
  );
  const category = categories.find((c) => c.id === categoryId) ?? categories[0]!;
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  // Null = the default area around the stop (decided by the server).
  const [area, setArea] = useState<Bounds | null>(null);
  const [initialArea, setInitialArea] = useState<Bounds | null>(null);
  const [view, setView] = useState<Bounds | null>(null);
  const [baseline, setBaseline] = useState<Bounds | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [panToKey, setPanToKey] = useState<string | null>(null);

  const search = useInfiniteQuery({
    queryKey: ['swap-search', trip.id, day.index, stop.id, categoryId, submittedKeyword, area],
    queryFn: ({ pageParam }) =>
      api.swapSearch(trip.id, day.index, stop.id, {
        category: categoryId,
        ...(submittedKeyword ? { q: submittedKeyword } : {}),
        ...(area ? { area } : {}),
        ...(pageParam ? { pageToken: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken,
  });

  const firstArea = search.data?.pages[0]?.area;
  if (firstArea && !initialArea) setInitialArea(firstArea);

  const results = useMemo(() => {
    const seen = new Set<string>();
    return (search.data?.pages ?? []).flatMap((p) => p.results).filter((c) => {
      const key = candidateKey(c);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [search.data]);

  const moved = view !== null && baseline !== null && viewMoved(view, baseline);
  const areaTooBig = view !== null && tooBig(view);

  /** Explicit searches always use the current view, even after a small pan or zoom. */
  const startSearch = (change: () => void) => {
    if (areaTooBig) return;
    change();
    if (view) {
      setArea(view);
      setBaseline(view);
    }
    setActiveKey(null);
  };

  const searchHere = () => {
    startSearch(() => setSubmittedKeyword(keyword.trim()));
  };

  const onViewChange = useCallback((next: Bounds) => {
    setView(next);
    setBaseline((b) => b ?? next);
  }, []);

  const markers = useMemo<AreaMapMarker[]>(
    () => [
      {
        id: CURRENT_ID,
        position: stop.place.location,
        emoji: STOP_ICONS[stopIconKind(stop)].emoji,
        badge: 'Now',
        title: `Current stop: ${stop.place.name}`,
        variant: 'current',
      },
      ...results.map((c, i) => ({
        id: candidateKey(c),
        position: c.place.location,
        emoji: RESULT_ICON[group],
        badge: String(i + 1),
        title: `${i + 1}. ${c.place.name}${c.place.rating ? ` · ★${c.place.rating}` : ''}`,
        variant: 'result' as const,
      })),
    ],
    [results, stop, group],
  );
  const routePaths = useMemo(() => dayRoutePaths(day), [day]);

  const selectFromMap = (id: string) => {
    if (id === CURRENT_ID) return;
    setActiveKey(id);
    const index = results.findIndex((c) => candidateKey(c) === id);
    document.getElementById(`swap-result-${index}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const choose = (candidate: PlaceCandidate) => onChoose(swappedStop(stop, candidate.place, category));

  const status = search.isLoading
    ? 'Searching…'
    : search.isError
      ? ''
      : `${results.length}${search.hasNextPage ? '+' : ''} ${results.length === 1 ? 'place' : 'places'} for ${category.label.toLowerCase()}${
          submittedKeyword ? ` matching “${submittedKeyword}”` : ''
        } in the map area`;

  return (
    <Modal title={`Swap ${stop.place.name}`} onClose={onClose} size="xl">
      <div className="swap">
        <div className="swap__panel">
          <div className="swap__controls">
            <label className="field">
              <span className="field__label">Find</span>
              <select
                className="input"
                value={categoryId}
                disabled={areaTooBig}
                onChange={(e) => {
                  const next = e.target.value;
                  startSearch(() => setCategoryId(next));
                }}
              >
                {sectionsOf(categories).map(([section, items]) => (
                  <optgroup key={section} label={section}>
                    {items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <form
              className="search-row"
              onSubmit={(e) => {
                e.preventDefault();
                startSearch(() => setSubmittedKeyword(keyword.trim()));
              }}
            >
              <input
                className="input"
                placeholder={KEYWORD_HINT[group]}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="Narrow it down"
                maxLength={80}
              />
              <button type="submit" className="button" disabled={areaTooBig}>
                Search
              </button>
            </form>
          </div>
          {areaTooBig && <p className="muted" role="status">Zoom in to search this map area.</p>}
          <p className="swap__status muted" aria-live="polite">
            {status}
          </p>
          <div className="swap__results">
            {search.isLoading && <Spinner label="Finding places…" />}
            {search.isError && <ErrorNote error={search.error} onRetry={() => void search.refetch()} />}
            {search.isSuccess && results.length === 0 && (
              <p className="muted">Nothing here yet. Zoom out on the map and search this area, or try another category.</p>
            )}
            {results.length > 0 && (
              <CandidateList
                candidates={results}
                numbered
                idPrefix="swap-result"
                activeKey={activeKey}
                onActivate={(key, how) => {
                  setActiveKey(key);
                  if (how === 'click') setPanToKey(key);
                }}
                minRating={trip.request.preferences.minRating}
                actionLabel="Swap in"
                onChoose={choose}
              />
            )}
            {search.hasNextPage && (
              <button
                type="button"
                className="button swap__more"
                onClick={() => void search.fetchNextPage()}
                disabled={search.isFetchingNextPage}
              >
                {search.isFetchingNextPage ? 'Loading…' : 'Show more results'}
              </button>
            )}
          </div>
        </div>
        <div className="swap__map">
          {initialArea ? (
            <AreaMap
              initialArea={initialArea}
              routePaths={routePaths}
              markers={markers}
              activeId={activeKey}
              panToId={panToKey}
              onSelect={selectFromMap}
              onViewChange={onViewChange}
            />
          ) : (
            <div className="swap__map-loading">{search.isError ? null : <Spinner label="Loading map…" />}</div>
          )}
          {moved && view && !search.isFetching && (
            <button
              type="button"
              className="button button--primary button--small swap__search-here"
              onClick={searchHere}
              disabled={tooBig(view)}
            >
              {tooBig(view) ? 'Zoom in to search here' : 'Search this area'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
