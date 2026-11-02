import { LODGING_TYPES, type LodgingType } from '@journey/shared';

const NOTES: Record<LodgingType, string> = {
  campground: 'We look for well-reviewed campgrounds and RV parks, and link Recreation.gov.',
  vacation_rental: 'We pick a good town for the night and link Airbnb & VRBO searches for your dates.',
  hotel: 'We choose top-rated hotels, motels and lodges close to your route.',
};

export function StepLodging({ value, onChange }: { value: LodgingType | null; onChange: (value: LodgingType) => void }) {
  return (
    <div className="lodging-options" role="radiogroup" aria-label="Lodging type">
      {(Object.keys(LODGING_TYPES) as LodgingType[]).map((type) => {
        const def = LODGING_TYPES[type];
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={value === type}
            className={`option-card${value === type ? ' is-selected' : ''}`}
            onClick={() => onChange(type)}
          >
            <span className="option-card__emoji" aria-hidden>
              {def.emoji}
            </span>
            <strong>{def.label}</strong>
            <span>{def.description}</span>
            <small>{NOTES[type]}</small>
          </button>
        );
      })}
    </div>
  );
}
