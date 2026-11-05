// oxlint-disable effect/noAsyncFunction, effect/noGlobals -- these fixtures exercise native Promise/fetch callers as well as Effect consumers
import { expect, it, vi } from '@effect/vitest'
import { Effect } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { makeOpenAIModel } from '../src/openai.ts'
import { askFails, assistantOn } from '../src/test-ask.ts'

it('catches native fetch', async () => {
  const result = await fetch('https://example.invalid/?secret-query').catch(
    () => undefined
  )
  expect(result).toBeUndefined()
})

it.effect('catches Effect fetch', () =>
  HttpClient.get('https://example.invalid').pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.ignore
  )
)

it('catches production adapter failure', () =>
  askFails(assistantOn(makeOpenAIModel({ apiKey: 'fake' })), (error) => {
    expect(error.reason).toContain('Provider connection failed')
  }))

it('allows explicit transport stubs', async () => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('stub')))
  const response = await fetch('https://example.invalid')
  expect(await response.text()).toBe('stub')
})

it('restores the guarded transport after the stub', () => {
  expect(vi.isMockFunction(globalThis.fetch)).toBe(false)
  expect(globalThis.fetch.name).toBe('guardedFetch')
})
