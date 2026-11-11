import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import LoginPage from './Login';
import {AuthProvider} from '@/hooks/useAuth';
import {ThemeProvider} from '@/theme/ThemeProvider';

function wrap() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({authenticated: false}), {
          headers: {'content-type': 'application/json'},
        });
      }
      if (url.includes('/api/auth/login') && init?.method === 'POST') {
        return new Response(JSON.stringify({error: {code: 'INVALID_PASSCODE', message: 'Incorrect'}}), {
          status: 401,
          headers: {'content-type': 'application/json'},
        });
      }
      return new Response('{}', {status: 404});
    }),
  );
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows an error on a rejected secret', async () => {
    wrap();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/organizer secret/i), 'wrong-secret');
    await user.click(screen.getByRole('button', {name: /sign in/i}));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
