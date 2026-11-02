import { useState } from 'react';
import { formatMinutes, type Stop, type StopInput } from '@journey/shared';
import { Modal } from '../components/Modal';
import { toStopInput } from '../lib/dayEdits';

const QUICK_DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240];

export function EditStopModal({ stop, onSave, onClose }: { stop: Stop; onSave: (stop: StopInput) => void; onClose: () => void }) {
  const [duration, setDuration] = useState(stop.durationMinutes);
  const [pinned, setPinned] = useState(stop.pinnedStart ?? '');
  const [notes, setNotes] = useState(stop.notes ?? '');
  const [locked, setLocked] = useState(true);

  const save = () => {
    const base = toStopInput(stop);
    const next: StopInput = { ...base, durationMinutes: duration, locked };
    if (pinned) next.pinnedStart = pinned;
    else delete next.pinnedStart;
    if (notes.trim()) next.notes = notes.trim();
    else delete next.notes;
    onSave(next);
  };

  return (
    <Modal
      title={`Edit ${stop.place.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={save}>
            Save & update timeline
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">Time spent here: {formatMinutes(duration)}</span>
        <div className="chips">
          {QUICK_DURATIONS.map((m) => (
            <button key={m} type="button" className={`chip chip--small${duration === m ? ' is-selected' : ''}`} onClick={() => setDuration(m)}>
              {formatMinutes(m)}
            </button>
          ))}
        </div>
        <input
          className="range"
          type="range"
          min={5}
          max={480}
          step={5}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          aria-label="Duration in minutes"
        />
      </div>
      <label className="field">
        <span className="field__label">Start no earlier than (optional)</span>
        <div className="inline">
          <input className="input input--auto" type="time" value={pinned} onChange={(e) => setPinned(e.target.value)} />
          {pinned && (
            <button type="button" className="button button--ghost button--small" onClick={() => setPinned('')}>
              Clear
            </button>
          )}
        </div>
        <small className="field__hint">Great for reservations, tee times or tours. We'll wait if you arrive early.</small>
      </label>
      <label className="field">
        <span className="field__label">Notes</span>
        <textarea className="input" rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Bring discs, reservation under Smith…" />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
        Keep this stop when regenerating the day
      </label>
    </Modal>
  );
}
