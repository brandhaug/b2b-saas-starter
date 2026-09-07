import { isMaintenanceMode } from '@b2b-saas-starter/env/server'

/**
 * Return the maintenance response for a request, or null when it may run.
 * Probe paths remain available so an operator can distinguish a paused
 * deployment from an unavailable worker while restoring its database.
 */
export function maintenanceResponse(
  request: Pick<Request, 'url'>,
  mode: string | undefined
): Response | null {
  if (!isMaintenanceMode(mode)) {
    return null
  }

  const pathname = new URL(request.url).pathname
  if (pathname === '/health' || pathname === '/ready') {
    return null
  }

  return Response.json({ error: 'maintenance_mode' }, { status: 503 })
}
