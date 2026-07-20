import type { OperationsWorkerEnv } from './index.ts'

declare global {
  namespace Cloudflare {
    interface Env extends OperationsWorkerEnv {}
  }
}

export {}
