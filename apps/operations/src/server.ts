import startServer from '@tanstack/react-start/server-entry'
import { env as workerEnv } from 'cloudflare:workers'
import { createOperationsWorker, type OperationsWorkerEnv } from './index.ts'

const operations = createOperationsWorker()

const belongsToAuthoritativeBoundary = (request: Request): boolean => {
  const pathname = new URL(request.url).pathname
  return (
    pathname === '/ready' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/__local/') ||
    (request.method === 'POST' &&
      /^\/(?:sign-in|verify-totp|enroll(?:\/.*)?|operators(?:\/.*)?|merchants\/[^/]+\/members\/[^/]+\/impersonations)$/.test(
        pathname
      ))
  )
}

export default {
  fetch(request: Request, passedEnv?: OperationsWorkerEnv) {
    if (belongsToAuthoritativeBoundary(request))
      return operations.fetch(
        request,
        passedEnv ?? (workerEnv as unknown as OperationsWorkerEnv)
      )
    return startServer.fetch(request)
  }
}
