import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../api/hooks';
import { ThemeToggle } from './ThemeProvider';

export function Layout({ children }: { children: ReactNode }) {
  const config = useConfig();
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <span>
            Enjoy the <em>Journey</em>
          </span>
        </Link>
        <nav className="topbar__nav">
          <Link to="/" className="topbar__link">
            My trips
          </Link>
          <Link to="/new" className="button button--primary button--small">
            + New journey
          </Link>
          <ThemeToggle />
        </nav>
      </header>
      {config.data?.dataSource === 'demo' && (
        <div className="demo-banner" role="note">
          <strong>Demo mode:</strong> places and routes are synthetic sample data. Add a Google Maps API key to plan with
          real places, ratings and drive times.
        </div>
      )}
      <main className="main">{children}</main>
    </div>
  );
}
