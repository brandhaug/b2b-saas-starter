import { env } from 'cloudflare:workers'
import {
  createOperationsWorker,
  type OperationsWorkerEnv
} from './operations-worker.ts'

const operations = createOperationsWorker()

export const handleOperationsHttp = (request: Request): Promise<Response> =>
  operations.fetch(request, env as unknown as OperationsWorkerEnv)
