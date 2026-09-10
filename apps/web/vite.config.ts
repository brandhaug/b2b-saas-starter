import mdx from '@mdx-js/rollup'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
// Named export rather than the identical default, so the local name matches
// what the package exports.
import { rehypePrettyCode } from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdxFrontmatter from 'remark-mdx-frontmatter'
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
// a resolvable stand-in (the inert shim evaluates to an all-undefined env
// bag in the browser), while the server bundle must externalize it so the
// deployed worker supplies the real `env` bindings — bundling the shim
// server-side would deploy `env.DB: undefined` and run the whole app
// provider-light. A `configEnvironment` plugin is used (rather than
// `environments` config) because it merges after the TanStack Start
// plugin defines its own environments.
function cloudflareWorkersDeployPlugin(
  inertShimPath: string,
  enabled: boolean
): PluginOption {
  return {
    name: 'b2b-starter:cloudflare-workers-deploy-resolution',
    // The TanStack Start plugin replaces the ssr environment's
    // `rolldownOptions` during planning, so `external` cannot be declared
    // through environment config — resolve per environment here instead.
    resolveId: {
      handler(source: string) {
        if (!enabled || source !== 'cloudflare:workers') {
          return null
        }
        if (this.environment.name === 'ssr') {
          // Keep the native import: the deployed worker runtime provides
          // the real module with the live `env` bindings.
          return { id: source, external: true }
        }
        if (this.environment.name === 'client') {
          // The browser cannot resolve a runtime module: stand in the
          // inert shim (an all-undefined env bag — the client never reads
          // a binding).
          return inertShimPath
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

export default defineConfig(({ command, mode }) => {
  const workersShim = resolveWorkersShim(command, mode)
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
    // Unminified, the bundled server tree blew the free Workers size limit;
    // minified, it still carried client-only vendor graphs (@sentry/react)
    // emitted as never-executed lazy chunks.
    // ADR 0063 strips those at the source and is the rule for any new
    // browser-only dynamic import.
    build: {
      minify: true,
      outDir: mode === 'e2e' ? 'dist-e2e' : 'dist'
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
    resolve: {
      tsconfigPaths: true,
      alias: workersShimAlias
    },
    plugins:
      lazyPlugins(() => [
        i18nCatalogPlugin(),
        devtools(),
        tailwindcss(),
        // Route tests colocate with their route files; the generator would
        // otherwise warn that each `*.test.tsx` exports no Route.
        tanstackStart({
          router: {
            routeFileIgnorePattern: '\\.test\\.'
          }
        }),
        {
          enforce: 'pre',
          ...mdx({
            remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter, remarkGfm],
            rehypePlugins: [
              rehypeSlug,
              [
                rehypePrettyCode,
                // Dual-theme keeps rehype-pretty-code emitting the `--shiki-dark*`
                // custom properties that index.css reads. Both slots are dark:
                // the app has one scheme. Catppuccin Mocha matches the page
                // palette; index.css additionally pins the pre background to
                // var(--card) so code blocks sit on the token surface.
                { theme: { dark: 'catppuccin-mocha', light: 'catppuccin-mocha' } }
              ]
            ]
          })
        },
        viteReact(),
        // React Compiler via the rolldown Babel bridge (plugin-react v6 API).
        // Email templates are invoked directly (no React dispatcher) when
        // rendering HTML, so compiler-inserted hooks crash there.
        babel({
          // A custom exclude replaces the plugin defaults. Keep vendor and
          // Rolldown runtime exclusions so dev does not recompile dependencies.
          exclude: [
            /[/\\]node_modules[/\\]|^\0rolldown\/runtime\.js$/,
            /packages[/\\]email[/\\]/
          ],
          presets: [reactCompilerPreset()]
        }),
        cloudflareWorkersDeployPlugin(
          resolve(import.meta.dirname, './src/lib/cloudflare-workers-shim.ts'),
          workersShim === null
        )
        // `lazyPlugins` returns `PluginOption[] | undefined` when the plugin factories are
        // skipped (vp check/lint/fmt don't need them), but this repo's
        // `exactOptionalPropertyTypes: true` rejects the explicit `undefined` against
        // Vite's `plugins` option — so coalesce to the equivalent "no plugins".
      ]) ?? [],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.output/**']
    }
  }
})
