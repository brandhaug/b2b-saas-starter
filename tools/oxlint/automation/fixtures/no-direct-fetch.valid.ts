// Nothing below may be reported by automation/no-direct-fetch.

type Fetcher = (input: string) => Promise<string>

// A parameter named `fetch` is an injected client, not the global.
export const injected = (fetch: Fetcher) => fetch('https://example.com')

// A local binding named `fetch` shadows the global.
export const local = () => {
  const fetch: Fetcher = (input) => Promise.resolve(input)
  return fetch('https://example.com')
}

// A method on a client object is not the global.
export const viaClient = (client: { fetch: Fetcher }) =>
  client.fetch('https://example.com')

// Type positions never call anything.
export type Handler = typeof globalThis.fetch
export const passThrough = (handler: Handler): Handler => handler
