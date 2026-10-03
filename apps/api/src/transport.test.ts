import { describe, expect, it } from 'vite-plus/test'

import worker from './index.ts'

describe('API Worker transport boundary', () => {
  it.each(['HEAD', 'OPTIONS'])(
    'audits production endpoints on %s requests',
    (method) => {
      expect(() =>
        worker.fetch(new Request('https://api.example.test/health', { method }), {
          ENVIRONMENT: 'production',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://analytics.example.test'
        })
      ).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT \(insecure\)/)
    }
  )
})
