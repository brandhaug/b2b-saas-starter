import { env } from 'cloudflare:workers'
import { createOperationsWorker, type OperationsWorkerEnv } from '@/index.ts'

const operations = createOperationsWorker()

export const handleOperationsHttp = (request: Request): Promise<Response> =>
  operations.fetch(request, env as unknown as OperationsWorkerEnv)
