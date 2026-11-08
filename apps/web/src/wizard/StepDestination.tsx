import { MAX_EVENT_HOURS, MAX_EVENT_NIGHTS, MAX_MAIN_EVENTS, type LatLng, type PlaceInfo, type StayUnit } from '@journey/shared';
import { Icon } from '../components/Icon';
import { PlaceAutocomplete } from '../components/PlaceAutocomplete';
import { newMainEvent, type MainEventDraft } from './draft';

interface StepDestinationProps {
  origin: PlaceInfo | null;
  destination: PlaceInfo | null;
  onDestinationChange: (destination: PlaceInfo | null) => void;
  roundTrip: boolean;
  onRoundTripChange: (roundTrip: boolean) => void;
  mainEvents: MainEventDraft[];
  /** Receives a change to apply to the latest list (place lookups finish after later edits). */
  onMainEventsChange: (change: (events: MainEventDraft[]) => MainEventDraft[]) => void;
  departureDate: string;
  autoFocus?: boolean;
}

const MAX_AMOUNT: Record<StayUnit, number> = { hours: MAX_EVENT_HOURS, nights: MAX_EVENT_NIGHTS };

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Destination (or a round trip home) plus optional main events to build the trip around. */
export function StepDestination(props: StepDestinationProps) {
  const { origin, roundTrip, mainEvents, onMainEventsChange } = props;
  const update = (id: string, patch: Partial<MainEventDraft>) => onMainEventsChange((events) => events.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const bias = (index: number): LatLng | undefined => (index > 0 ? mainEvents[index - 1]?.place?.location : undefined) ?? origin?.location;

  return (
    <div className="step-destination">
      {roundTrip ? (
        <p className="round-trip-note">
          The trip ends back at <strong>{origin?.name ?? 'your starting point'}</strong>.
        </p>
      ) : (
        <PlaceAutocomplete
          key="destination"
          label="Destination"
          placeholder="Search a city, address or place"
          value={props.destination}
          onChange={props.onDestinationChange}
          bias={mainEvents.at(-1)?.place?.location ?? origin?.location}
          autoFocus={props.autoFocus}
        />
      )}
      <label className="checkbox">
        <input type="checkbox" checked={roundTrip} onChange={(e) => props.onRoundTripChange(e.target.checked)} />
        Round trip: end back where I started
      </label>

      <section className="main-events">
        <h3>Main events {roundTrip ? '' : '(optional)'}</h3>
        <p className="muted">
          Places the trip is built around: a concert, a national park, family. We visit them in this order
          {roundTrip ? ' and then head home' : ' before your destination'}, and plan the drives in between.
        </p>
        {mainEvents.length > 0 && (
          <ol className="main-events__list">
            {mainEvents.map((event, i) => {
              const hours = event.stayUnit === 'hours';
              return (
                <li key={event.id} className="main-event">
                  <div className="main-event__head">
                    <span className="selected-activity__rank" aria-hidden>
                      {i + 1}
                    </span>
                    <PlaceAutocomplete
                      label={`Main event ${i + 1}`}
                      placeholder="Search a city, park, venue…"
                      value={event.place}
                      onChange={(place) => update(event.id, { place })}
                      bias={bias(i)}
                      autoFocus={event.place === null}
                    />
                    <span className="main-event__actions">
                      <button type="button" className="icon-button" aria-label={`Move main event ${i + 1} earlier`} disabled={i === 0} onClick={() => onMainEventsChange((events) => move(events, i, i - 1))}>
                        <Icon name="up" />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Move main event ${i + 1} later`}
                        disabled={i === mainEvents.length - 1}
                        onClick={() => onMainEventsChange((events) => move(events, i, i + 1))}
                      >
                        <Icon name="down" />
                      </button>
                      <button type="button" className="icon-button" aria-label={`Remove main event ${i + 1}`} onClick={() => onMainEventsChange((events) => events.filter((e) => e.id !== event.id))}>
                        <Icon name="close" />
                      </button>
                    </span>
                  </div>
                  <div className="main-event__details">
                    <label className="field">
                      <span className="field__label">Stay</span>
                      <span className="main-event__stay">
                        <input
                          className="input input--auto"
                          type="number"
                          min={1}
                          max={MAX_AMOUNT[event.stayUnit]}
                          value={event.stayAmount}
                          aria-label={`How many ${event.stayUnit} at main event ${i + 1}`}
                          onChange={(e) => update(event.id, { stayAmount: Math.max(1, Math.min(MAX_AMOUNT[event.stayUnit], Math.round(Number(e.target.value)) || 1)) })}
                        />
                        <select
                          className="input input--auto"
                          value={event.stayUnit}
                          aria-label={`Stay unit for main event ${i + 1}`}
                          onChange={(e) => {
                            const stayUnit = e.target.value as StayUnit;
                            update(event.id, { stayUnit, stayAmount: Math.min(event.stayAmount, MAX_AMOUNT[stayUnit]) });
                          }}
                        >
                          <option value="hours">{event.stayAmount === 1 ? 'hour' : 'hours'}</option>
                          <option value="nights">{event.stayAmount === 1 ? 'night' : 'nights'}</option>
                        </select>
                      </span>
                    </label>
                    <label className="field">
                      <span className="field__label">Be there on (optional)</span>
                      <input
                        className="input input--auto"
                        type="date"
                        min={props.departureDate}
                        value={event.arrivalDate ?? ''}
                        onChange={(e) => update(event.id, { arrivalDate: e.target.value || null, ...(e.target.value ? {} : { arrivalTime: null }) })}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">{hours ? 'Starts at' : 'Arrive by'} (optional)</span>
                      <input
                        className="input input--auto"
                        type="time"
                        disabled={!event.arrivalDate}
                        value={event.arrivalTime ?? ''}
                        onChange={(e) => update(event.id, { arrivalTime: e.target.value || null })}
                      />
                    </label>
                  </div>
                  <p className="field__hint">
                    {hours
                      ? 'A few hours there, then the drive continues the same day.'
                      : `We find ${event.stayAmount === 1 ? 'a place' : 'one place'} to stay nearby${event.stayAmount > 1 ? ` and keep ${event.stayAmount - 1} day${event.stayAmount > 2 ? 's' : ''} free for you to plan` : ''}.`}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        <button
          type="button"
          className="button"
          disabled={mainEvents.length >= MAX_MAIN_EVENTS}
          onClick={() => onMainEventsChange((events) => (events.length >= MAX_MAIN_EVENTS ? events : [...events, newMainEvent()]))}
        >
          + Add a main event
        </button>
        {mainEvents.length >= MAX_MAIN_EVENTS && <small className="muted"> Up to {MAX_MAIN_EVENTS} main events.</small>}
      </section>
    </div>
  );
}
