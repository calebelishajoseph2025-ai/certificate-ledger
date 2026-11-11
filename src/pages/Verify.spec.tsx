import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import VerifyPage from './Verify';
import {ThemeProvider} from '@/theme/ThemeProvider';

function wrap(ui: React.ReactNode, path = '/verify') {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/verify" element={ui} />
            <Route path="/verify/:certId" element={ui} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('VerifyPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders valid credential details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/branding')) {
          return new Response(
            JSON.stringify({
              issuerName: 'Northwind',
              signatory1Name: 'A',
              signatory1Title: 'B',
              signatory2Name: 'C',
              signatory2Title: 'D',
              publicBaseUrl: 'http://example.test',
            }),
            {headers: {'content-type': 'application/json'}},
          );
        }
        return new Response(
          JSON.stringify({
            status: 'valid',
            signature: 'not_provided',
            holder_name: 'Elena Rostova',
            course_title: 'Intro to Data Storytelling',
            issuer_name: 'Northwind',
            issued_at: '2026-02-15T00:00:00.000Z',
          }),
          {headers: {'content-type': 'application/json'}},
        );
      }),
    );

    wrap(<VerifyPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/public verification/i), 'CL-26-TESTID01');
    await user.click(screen.getByRole('button', {name: /look up/i}));
    expect(await screen.findByText('Elena Rostova')).toBeInTheDocument();
    expect(screen.getByText(/valid credential/i)).toBeInTheDocument();
  });
});
