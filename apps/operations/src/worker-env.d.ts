import type { OperationsWorkerEnv } from './lib/server/operations-worker.ts'

declare global {
  namespace Cloudflare {
    interface Env extends OperationsWorkerEnv {}
  }
}

export {}
