import { createFileRoute } from '@tanstack/react-router'
import { readSupportConfig } from '@/lib/support-config.effects'

/** Public, non-secret support configuration. No session or database access. */
export const Route = createFileRoute('/api/support-config')({
  server: {
    handlers: {
      GET: () => Response.json(readSupportConfig())
    }
  }
})
