/* oxlint-disable effect/noNodeBuiltinImport, effect/noThrowStatement, effect/noNewError, effect/noNewPromise, effect/noTryCatch -- Native development runtime startup has no application Effect runtime. */
// Node startup boundary shared by Vite dev and built E2E preview. Kept outside
// Vite's server bundle so native Worker modules only execute inside workerd.
import { workerCompatibility } from '../../../infra/bindings.ts'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'
import {
  Miniflare,
  Request as MiniflareRequest,
  convertV4MiniflareOptions
} from 'miniflare'

const webRoot = dirname(import.meta.dirname)
const persistRoot = join(webRoot, '../../packages/db/.wrangler/state/v3')
let active
let pending

async function start() {
  if (!existsSync(join(persistRoot, 'd1'))) {
    return
  }
  const bundle = await build({
    entryPoints: [join(webRoot, 'scripts/local-assistant-worker.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire('/worker.js');"
    },
    target: 'es2022',
    external: ['cloudflare:*', 'node:*'],
    conditions: ['workerd', 'worker', 'browser'],
    logLevel: 'silent'
  })
  const output = bundle.outputFiles[0]
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- esbuild output is checked at the native startup boundary
  if (!output) {
    throw new Error('Local conversation Worker bundling produced no output.')
  }
  const bindings = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        /^(ASSISTANT_|OPENAI_|WORKERS_AI_|MCP_|BETTER_AUTH_|ENVIRONMENT$)/.test(key)
    )
  )
  active = new Miniflare(
    convertV4MiniflareOptions({
      name: 'starter-local-assistant',
      modules: true,
      script: output.text,
      compatibilityDate: workerCompatibility.date,
      compatibilityFlags: [...workerCompatibility.flags],
      cf: false,
      d1Databases: { DB: 'placeholder' },
      resourcePersistencePath: persistRoot,
      isolatedResourcePersistencePath: persistRoot,
      durableObjects: {
        ASSISTANT_CONVERSATIONS: {
          className: 'WorkspaceAssistantConversation',
          useSQLite: true
        }
      },
      bindings
    })
  )
  const DB = await active.getD1Database('DB')
  const namespace = await active.getDurableObjectNamespace('ASSISTANT_CONVERSATIONS')
  return { DB, ASSISTANT_CONVERSATIONS: localConversationNamespace(namespace) }
}

export function localConversationNamespace(namespace) {
  // Miniflare's Undici Request differs from Node's built-in Request. Convert at
  // this platform seam, preserving the verified server-generated invocation.
  return {
    getByName(name) {
      const stub = namespace.getByName(name)
      return {
        fetch(request) {
          const init = {
            method: request.method,
            headers: Object.fromEntries(request.headers),
            signal: request.signal
          }
          if (request.body !== null) {
            init.body = request.body
            init.duplex = 'half'
          }
          return stub.fetch(new MiniflareRequest(request.url, init))
        }
      }
    }
  }
}

async function startWithDeadline() {
  let timer
  try {
    return await Promise.race([
      start(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Local Worker did not attach within 30 seconds.')),
          30_000
        )
        timer.unref()
      })
    ])
  } catch (error) {
    void active?.dispose()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function localWorkerBindings() {
  pending ??= startWithDeadline()
  return pending
}

export async function disposeLocalWorker() {
  await active?.dispose()
  active = undefined
  pending = undefined
}
