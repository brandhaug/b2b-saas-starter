import { describe, expect, it } from 'vite-plus/test'

import { maintenanceResponse } from './maintenance'

describe('maintenance boundary', () => {
  it('blocks auth, SSR, and server-function paths while paused', async () => {
    for (const path of [
      '/api/auth/get-session',
      '/workspaces/starter-lab',
      '/_serverFn'
    ]) {
      const response = maintenanceResponse(
        new Request(`https://starter.example${path}`),
        'true'
      )
      expect(response?.status).toBe(503)
      await expect(response?.json()).resolves.toEqual({ error: 'maintenance_mode' })
    }
  })

  it('keeps health and readiness probes available while paused', () => {
    expect(
      maintenanceResponse(new Request('https://starter.example/health'), 'true')
    ).toBeNull()
    expect(
      maintenanceResponse(new Request('https://starter.example/ready'), 'true')
    ).toBeNull()
  })
})
