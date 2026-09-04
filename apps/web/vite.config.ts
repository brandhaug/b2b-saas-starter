import mdx from '@mdx-js/rollup'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { resolve } from 'node:path'
// Named export rather than the identical default, so the local name matches
// what the package exports.
import { rehypePrettyCode } from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdxFrontmatter from 'remark-mdx-frontmatter'
import { defineConfig, lazyPlugins, loadEnv, type PluginOption } from 'vite-plus'

function remarkMermaid() {
  return (tree: { children: Array<Record<string, unknown>> }) => {
    // mdast nodes arrive untyped from the MDX pipeline, so the child list is
    // narrowed at runtime instead of asserted.
    function childrenOf(
      node: Record<string, unknown>
    ): Array<Record<string, unknown>> | undefined {
      return Array.isArray(node.children) ? node.children : undefined
    }
    function visit(node: Record<string, unknown>) {
      const children = childrenOf(node)
      if (!children) {
        return
      }
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (!child) {
          continue
        }
        if (child.type === 'code' && child.lang === 'mermaid') {
          children[i] = {
            type: 'mdxJsxFlowElement',
            name: 'MdxMermaid',
            attributes: [
              {
                type: 'mdxJsxAttribute',
                name: 'chart',
                value: child.value
              }
            ],
            children: []
          }
        } else {
          visit(child)
        }
      }
    }
    visit(tree)
  }
}

// Which `cloudflare:workers` shim to alias, or null to leave the specifier
// alone (the deployed worker resolves it natively). `vite dev` gets the dev
// shim, which attaches the persisted local D1 when packages/db has migrated
// state; test and opt-in builds keep the inert shim so bundles never pull in
// wrangler.
function resolveWorkersShim(command: 'build' | 'serve', mode: string): string | null {
  if (mode !== 'test' && process.env.B2B_STARTER_USE_WORKERS_SHIM !== '1') {
    return null
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

export default defineConfig(({ command, mode }) => {
  const workersShim = resolveWorkersShim(command, mode)
  const workersShimAlias = workersShim
    ? { 'cloudflare:workers': resolve(import.meta.dirname, workersShim) }
    : {}
  // Storybook's vite builder loads this config too (it merges everything but
  // `build` into its own program) and its mocker runtime emits a second entry
  // chunk, which TanStack's client-manifest capture rejects. Storybook never
  // renders Start routes, so the Start plugin has nothing to do there.
  const isStorybook = process.env.STORYBOOK === 'true'
  // Storybook's build runs no Worker and no vitest program, so it gets the same
  // inert stand-ins the test build uses: `cloudflare:workers` resolves to the
  // provider-light shim (bindings undefined, Seed layers active), and the
  // package-internal TanStack entry specifiers resolve to stubs (the
  // tanstackStart plugin that normally aliases them is absent here — its
  // client-manifest capture also rejects Storybook's mocker entry chunk; see
  // `storybook-start-entries.ts`).
  const storybookAliases = isStorybook
    ? {
        // Storybook runs no Worker, so bindings resolve to the same inert
        // provider-light shim the test build uses.
        'cloudflare:workers': resolve(
          import.meta.dirname,
          'src/lib/cloudflare-workers-shim.ts'
        ),
        // Keep the whole TanStack server-core graph out of Storybook's build.
        '@tanstack/react-start/server': resolve(
          import.meta.dirname,
          'src/lib/storybook-react-start-server-stub.ts'
        ),
        // Belt and braces: anything that still slips through the server edge
        // (a future direct import of a start-server-core module) resolves the
        // package-internal entry specifiers the tanstackStart plugin would
        // normally alias.
        '#tanstack-start-entry': resolve(
          import.meta.dirname,
          'src/lib/storybook-start-entries.ts'
        ),
        '#tanstack-router-entry': resolve(
          import.meta.dirname,
          'src/lib/storybook-start-entries.ts'
        )
      }
    : {}
  // Bun's auto-`.env`
  // loading nor Vite's `envDir` reach the repo-root `.env` — but the workers
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
    // minified, it still carried client-only vendor graphs (mermaid,
    // posthog-js, @sentry/react) emitted as never-executed lazy chunks.
    // ADR 0063 strips those at the source and is the rule for any new
    // browser-only dynamic import.
    build: { minify: true },
    server: { port: 3071, host: 'localhost' },
    preview: { port: 3071, host: 'localhost' },
    resolve: {
      tsconfigPaths: true,
      alias: {
        ...workersShimAlias,
        ...storybookAliases
      }
    },
    plugins:
      lazyPlugins(() => [
        devtools(),
        tailwindcss(),
        // Route tests colocate with their route files; the generator would
        // otherwise warn that each `*.test.tsx` exports no Route.
        ...(isStorybook
          ? []
          : [
              tanstackStart({
                router: { routeFileIgnorePattern: '\\.test\\.' }
              })
            ]),
        {
          enforce: 'pre',
          ...mdx({
            remarkPlugins: [
              remarkFrontmatter,
              remarkMdxFrontmatter,
              remarkGfm,
              remarkMermaid
            ],
            rehypePlugins: [
              rehypeSlug,
              [
                rehypePrettyCode,
                // Dual-theme keeps rehype-pretty-code emitting the `--shiki-dark*`
                // custom properties that index.css reads. Both slots are dark:
                // the app has one scheme.
                { theme: { dark: 'github-dark', light: 'github-dark' } }
              ]
            ]
          })
        },
        viteReact(),
        // React Compiler via the rolldown Babel bridge (plugin-react v6 API).
        // Email templates are invoked directly (no React dispatcher) when
        // rendering HTML, so compiler-inserted hooks crash there.
        babel({
          exclude: /packages[/\\]email[/\\]/,
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
