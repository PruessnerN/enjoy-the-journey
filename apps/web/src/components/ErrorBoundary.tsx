import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Keeps a rendering bug from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card empty" role="alert">
        <h1>We hit a bump in the road</h1>
        <p className="muted">{this.state.error.message}</p>
        <button type="button" className="button button--primary" onClick={() => window.location.assign('/')}>
          Back to my trips
        </button>
      </div>
    );
  }
}
