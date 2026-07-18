import { AppRouter } from '@/app/router';
import { AppProviders } from '@/app/providers';
import '@/styles/globals.css';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
