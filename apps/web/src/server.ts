import startServer from '@tanstack/react-start/server-entry'
import { env as workerEnv } from 'cloudflare:workers'
import {
  dispatchBookingRequest,
  type BookingIngressEnv
} from './lib/booking-dispatch.ts'

export default {
  async fetch(request: Request, env?: BookingIngressEnv): Promise<Response> {
    // TanStack's Vite dev adapter invokes the entry with the global Workers
    // env; deployed Workers also pass it as the second argument. Supporting
    // both keeps the local proxy and production service binding on one path.
    return await dispatchBookingRequest(request, env ?? workerEnv, () =>
      Promise.resolve(startServer.fetch(request))
    )
  }
}
