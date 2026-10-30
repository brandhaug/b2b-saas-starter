import { localAssistantSockets } from './scripts/local-socket-plugin'
import { foldkitPreview } from './scripts/foldkit-preview'
import { browserBoundary } from './scripts/browser-boundary'
import { docsSearchIndex } from './scripts/docs-search-index'
import { foldkitDocs } from './src/foldkit/docs/build'
import tailwindcss from '@tailwindcss/vite'
import { foldkit } from '@foldkit/vite-plugin'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type * as LocalWorkerRuntime from './scripts/local-worker-runtime.mjs'
import { defineConfig, lazyPlugins, loadEnv, type PluginOption } from 'vite-plus'

// Which `cloudflare:workers` shim to alias, or null to leave the specifier
// alone (the deployed worker resolves it natively). `vite dev` gets the dev
// shim, and the dedicated e2e build gets its Node preview shim; both attach
// persisted local D1 when packages/db has migrated state. Tests and ordinary
// opt-in builds keep the inert shim so bundles never pull in wrangler.
function resolveWorkersShim(command: 'build' | 'serve', mode: string): string | null {
  if (
    mode !== 'test' &&
    mode !== 'e2e' &&
    process.env.B2B_STARTER_USE_WORKERS_SHIM !== '1'
  ) {
    return null
  }
  if (mode === 'e2e') {
    return './scripts/cloudflare-workers-shim-e2e.ts'
  }
  return command === 'serve' && mode !== 'test'
    ? './src/lib/cloudflare-workers-shim-dev.ts'
    : './src/lib/cloudflare-workers-shim.ts'
}

// Without the shim (alchemy's deploy build), the two build targets need
// opposite treatment for `cloudflare:workers`: the client bundle must keep
// rejection, while the server bundle must externalize it so the deployed
// Worker supplies the real bindings. A browser import is a boundary violation.
function cloudflareWorkersDeployPlugin(enabled: boolean): PluginOption {
  return {
    name: 'b2b-starter:cloudflare-workers-deploy-resolution',
    resolveId: {
      handler(source: string) {
        if (!enabled || !source.startsWith('cloudflare:')) {
          return null
        }
        if (this.environment.name === 'ssr') {
          // Keep the native import: the deployed worker runtime provides
          // the real module with the live `env` bindings.
          return { id: source, external: true }
        }
        if (this.environment.name === 'client') {
          return this.error(`Server-only import in browser graph: ${source}`)
        }
        return null
      }
    }
  }
}

// Domain catalogs live outside the web package so backend, email, and web
// messages can share one generated Paraglide module. Compile them before Vite
// resolves the application graph, and watch the source directories in dev so
// a translation edit refreshes the page without requiring a separate process.
function i18nCatalogPlugin(): PluginOption {
  const i18nRoot = resolve(import.meta.dirname, '../../packages/i18n')
  const messagesRoot = resolve(i18nRoot, 'messages')
  const compileScript = resolve(i18nRoot, 'scripts/compile.mjs')

  function compileCatalogs() {
    execFileSync(process.execPath, [compileScript], {
      cwd: i18nRoot,
      stdio: 'inherit'
    })
  }

  return {
    name: 'b2b-starter:i18n-catalogs',
    enforce: 'pre',
    buildStart() {
      compileCatalogs()
    },
    configureServer(server) {
      server.watcher.add(messagesRoot)
    },
    handleHotUpdate({ file, server }) {
      if (file !== messagesRoot && !file.startsWith(`${messagesRoot}/`)) {
        return
      }
      compileCatalogs()
      server.moduleGraph.invalidateAll()
      server.ws.send({ type: 'full-reload' })
      return []
    }
  }
}

// Release the companion workerd process when Vite dev or preview closes.
function localWorkerLifecyclePlugin(): PluginOption {
  async function dispose() {
    const moduleUrl = pathToFileURL(
      resolve(import.meta.dirname, 'scripts/local-worker-runtime.mjs')
    ).href
    const runtime: typeof LocalWorkerRuntime = await import(
      /* @vite-ignore */ moduleUrl
    )
    await runtime.disposeLocalWorker()
  }
  return {
    name: 'b2b-starter:local-worker-lifecycle',
    configureServer(server) {
      server.httpServer?.once('close', () => {
        void dispose()
      })
    },
    configurePreviewServer(server) {
      server.httpServer.once('close', () => {
        void dispose()
      })
    }
  }
}

export default defineConfig(({ command, mode }) => {
  let outputRoot = 'dist'
  if (mode === 'e2e') {
    outputRoot = 'dist-e2e'
  } else if (mode === 'docs-runtime') {
    outputRoot = 'dist-docs-runtime'
  }
  const workersShim = resolveWorkersShim(command, mode)
  if (command === 'build' && mode !== 'test') {
    execFileSync(
      process.execPath,
      [resolve(import.meta.dirname, 'scripts/generate-agent-exports.mjs')],
      { stdio: 'inherit' }
    )
  }
  const workersShimAlias = workersShim
    ? { 'cloudflare:workers': resolve(import.meta.dirname, workersShim) }
    : {}
  // No auto-`.env`
  // loading reaches the repo-root `.env`, and neither does Vite's `envDir` — but the workers
  // shim and the capability layers read `process.env` directly, so every
  // value in that file (auth origins, optional providers) was silently
  // ignored in dev while docs/setup.md promised it worked. Load the root
  // `.env` into `process.env` for the dev server; real environment variables
  // win, matching dotenv conventions. Build and test keep their existing
  // env paths (alchemy/wrangler for deploy, the inert shim for tests).
  if (command === 'serve') {
    const rootEnv = loadEnv(mode, resolve(import.meta.dirname, '../..'), '')
    for (const [key, value] of Object.entries(rootEnv)) {
      if (key !== 'NODE_ENV' && process.env[key] === undefined && value !== '') {
        process.env[key] = value
      }
    }
  }
  return {
    // The ssr environment does not minify by default in rolldown-vite, and
    // the deployed web worker bundle is its output verbatim: `Website.Vite`
    // uploads every `dist/server` chunk the deploy build emits, and that
    // build bundles node_modules (the injected Cloudflare plugin resolves
    // with `noExternal`, since workerd cannot resolve bare specifiers).
    // Minification does not remove every browser-only vendor graph from SSR.
    // Inspect deployment-shaped chunks after dependency changes (ADR 0063).
    build: {
      minify: true,
      outDir: `${outputRoot}/client`
    },
    // `forwardConsole` auto-enables when an AI coding agent is detected, and
    // mirrored `[Server]` errors (e.g. the pre-migration MissingD1Binding 500
    // storm) then flood the terminal — a dev process died at 1.67M log lines
    // this way. The D1-absent path now answers 503 instead of throwing, but
    // the forwarding itself stays off for this app.
    server: {
      port: 3071,
      host: 'localhost',
      forwardConsole: false,
      watch: { ignored: ['**/packages/i18n/src/generated/**'] }
    },
    preview: { port: 3071, host: 'localhost' },
    appType: 'custom',
    resolve: {
      tsconfigPaths: true,
      alias: workersShimAlias
    },
    plugins:
      lazyPlugins(() => [
        i18nCatalogPlugin(),
        docsSearchIndex(),
        foldkitDocs(),
        ...(workersShim === null
          ? []
          : [
              localWorkerLifecyclePlugin(),
              localAssistantSockets(`${outputRoot}/server`)
            ]),
        tailwindcss(),
        ...(mode === 'test'
          ? []
          : foldkit({
              devToolsMcpPort: false,
              ssr: {
                serverEntry: '/src/entry.server.ts',
                clientEntry: '/src/foldkit/browser.ts',
                build: {
                  clientOutDir: `${outputRoot}/client`,
                  serverOutDir: `${outputRoot}/server`
                }
              }
            })),
        foldkitPreview(`${outputRoot}/server`),
        browserBoundary(),
        cloudflareWorkersDeployPlugin(workersShim === null)
        // `lazyPlugins` returns `PluginOption[] | undefined` when the plugin factories are
        // skipped (vp check/lint/fmt don't need them), but this repo's
        // `exactOptionalPropertyTypes: true` rejects the explicit `undefined` against
        // Vite's `plugins` option — so coalesce to the equivalent "no plugins".
      ]) ?? [],
    test: {
      globals: true,
      environment: 'jsdom',
      exclude: [
        'e2e/**',
        'test/assistant/*.pool.test.ts',
        'test/docs/cold-runtime.test.ts',
        'node_modules/**',
        'dist/**',
        '.output/**'
      ]
    }
  }
})
