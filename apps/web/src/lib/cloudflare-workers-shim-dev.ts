import { type ConversationNamespace } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation-transport'
import type * as LocalWorkerRuntime from '../../scripts/local-worker-runtime.mjs'
// The browser gets the inert env. Node SSR attaches migrated local D1 and a
// native SQLite conversation host; the dynamic path keeps workerd out of Vite.
import { type D1Database } from '@cloudflare/workers-types'
import { env as baseEnv } from './cloudflare-workers-shim.ts'

type LocalBindings = {
  DB: D1Database
  ASSISTANT_CONVERSATIONS: ConversationNamespace
}

async function localBindings(): Promise<LocalBindings | undefined> {
  if (!import.meta.env.SSR) {
    return undefined
  }
  const { pathToFileURL } = await import('node:url')
  const { resolve } = await import('node:path')
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), 'scripts/local-worker-runtime.mjs')
  ).href
  const runtime: typeof LocalWorkerRuntime = await import(/* @vite-ignore */ moduleUrl)
  return runtime.localWorkerBindings()
}

export const env = { ...baseEnv, ...(await localBindings()) }
