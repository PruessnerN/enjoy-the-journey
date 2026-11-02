import { useEffect, useId, useRef, useState } from 'react';
import type { LatLng, PlaceInfo, PlaceSuggestion } from '@journey/shared';
import { api } from '../api/client';
import { randomId } from '../lib/id';
import { Icon } from './Icon';

interface PlaceAutocompleteProps {
  label: string;
  placeholder?: string;
  value: PlaceInfo | null;
  onChange: (place: PlaceInfo | null) => void;
  bias?: LatLng | undefined;
  autoFocus?: boolean;
}

const newSession = () => randomId();

/** Search-as-you-type place picker backed by the API's autocomplete endpoint. */
export function PlaceAutocomplete({ label, placeholder, value, onChange, bias, autoFocus }: PlaceAutocompleteProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(newSession());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await api.autocomplete(q, session.current, bias);
        if (!cancelled) {
          setSuggestions(results);
          setActive(0);
          setOpen(true);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, bias]);

  const choose = async (suggestion: PlaceSuggestion) => {
    setOpen(false);
    setLoading(true);
    try {
      const place = await api.place(suggestion.placeId, session.current);
      session.current = newSession();
      setQuery('');
      setSuggestions([]);
      onChange(place);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that place');
    } finally {
      setLoading(false);
    }
  };

  if (value) {
    return (
      <div className="field">
        <span className="field__label">{label}</span>
        <div className="place-chip">
          <span className="place-chip__pin" aria-hidden>
            <Icon name="pin" size={20} />
          </span>
          <span className="place-chip__text">
            <strong>{value.name}</strong>
            {value.address && value.address !== value.name && <small>{value.address}</small>}
          </span>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => {
              onChange(null);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  const listId = `${id}-list`;
  return (
    <div className="field autocomplete">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="input input--large"
        type="text"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && suggestions[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const s = suggestions[active];
            if (s) void choose(s);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {loading && <span className="autocomplete__spinner spinner" aria-label="Searching" />}
      {open && suggestions.length > 0 && (
        <ul className="autocomplete__list" id={listId} role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`autocomplete__option${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                void choose(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <strong>{s.primaryText}</strong>
              {s.secondaryText && <small>{s.secondaryText}</small>}
            </li>
          ))}
        </ul>
      )}
      {open && !loading && query.trim().length >= 2 && suggestions.length === 0 && (
        <p className="field__hint">No matches yet — try a city, address or place name.</p>
      )}
      {error && <p className="field__error">{error}</p>}
    </div>
  );
}
