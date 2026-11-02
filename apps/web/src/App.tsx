import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ApiError } from './api/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { ThemeProvider } from './components/ThemeProvider';
import { HomePage } from './pages/HomePage';
import { NewTripPage } from './pages/NewTripPage';
import { TripPage } from './pages/TripPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Layout>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/new" element={<NewTripPage />} />
                <Route path="/trips/:id" element={<TripPage />} />
                <Route
                  path="*"
                  element={
                    <div className="card empty">
                      <h1>Off the map!</h1>
                      <p>
                        That page doesn't exist. <Link to="/">Head back home</Link>.
                      </p>
                    </div>
                  }
                />
              </Routes>
            </ErrorBoundary>
          </Layout>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
