import { describe, expect, it } from 'vite-plus/test'

import worker from './index.ts'

describe('API Worker transport boundary', () => {
  it.each(['HEAD', 'OPTIONS'])(
    'audits production endpoints on %s requests that Sentry does not instrument',
    (method) => {
      expect(() =>
        worker.fetch(new Request('https://api.example.test/health', { method }), {
          ENVIRONMENT: 'production',
          POSTHOG_HOST: 'http://analytics.example.test'
        })
      ).toThrow(/POSTHOG_HOST \(insecure\)/)
    }
  )
})
