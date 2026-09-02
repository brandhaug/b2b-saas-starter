import { type ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'

/**
 * Renders a component that reads TanStack Query — a `useQuery` panel, or any
 * `useServerAction` mutation — under its own client. Retries are off so a
 * failing call surfaces in the first assertion rather than after a backoff, and
 * the client is per-render so no cache crosses between tests.
 *
 * Use `renderWithRouter` instead when the component also needs a router; it
 * provides a client of its own.
 */
export function renderWithQueryClient(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
