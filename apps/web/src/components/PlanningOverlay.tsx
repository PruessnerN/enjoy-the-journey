import { useEffect, useState } from 'react';

const MESSAGES = [
  'Mapping your route…',
  'Splitting the drive into days that make real progress…',
  'Scouting the best-rated stops along the way…',
  'Checking opening hours and sunset times…',
  'Lining up meals at mealtime…',
  'Finding somewhere cozy to sleep each night…',
  'Polishing your timeline…',
];

/** Full-screen progress while the planner works (it can take several seconds with live data). */
export function PlanningOverlay({ title = 'Planning your journey' }: { title?: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => Math.min(i + 1, MESSAGES.length - 1)), 1800);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="planning-overlay" role="status" aria-live="polite">
      <div className="planning-overlay__card">
        <div className="road-animation" aria-hidden>
          <span className="road-animation__car">🚙</span>
        </div>
        <h2>{title}</h2>
        <p>{MESSAGES[index]}</p>
      </div>
    </div>
  );
}
