import { dehydrate, hydrate, QueryClient, QueryObserver } from '@tanstack/react-query'
import { expect, it, vi } from 'vite-plus/test'
import { pageQueryOptions } from './page-query'

// Failure cases: a route refresh reuses stale pre-mutation data; hydration
// fetches twice; another actor/workspace/search shares a private payload.
it('refreshes a loader read while a hydrated observer uses the same cache without fetching', async () => {
  const read = vi.fn(async () => ({ revision: 1 }))
  const options = pageQueryOptions(['page', 'actor', 'workspace'], read)
  const server = new QueryClient()
  await server.query({ ...options, staleTime: 0 })
  const client = new QueryClient()
  hydrate(client, dehydrate(server))
  const observer = new QueryObserver(client, options)
  const unsubscribe = observer.subscribe(() => {})
  expect(observer.getCurrentResult().data).toEqual({ revision: 1 })
  expect(read).toHaveBeenCalledTimes(1)
  read.mockResolvedValue({ revision: 2 })
  await client.query({ ...options, staleTime: 0 })
  expect(observer.getCurrentResult().data).toEqual({ revision: 2 })
  expect(read).toHaveBeenCalledTimes(2)
  unsubscribe()
  server.clear()
  client.clear()
})

it('keeps actor, workspace and search variants separate', async () => {
  const client = new QueryClient()
  for (const key of [
    ['audit', 'alice', 'one', { cursor: 'first' }],
    ['audit', 'bob', 'one', { cursor: 'first' }],
    ['audit', 'alice', 'two', { cursor: 'first' }],
    ['audit', 'alice', 'one', { cursor: 'second' }]
  ]) {
    const read = vi.fn(async () => key)
    await client.query(pageQueryOptions(key, read))
    expect(read).toHaveBeenCalledTimes(1)
  }
  expect(client.getQueryCache().getAll()).toHaveLength(4)
  client.clear()
})
