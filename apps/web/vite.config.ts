import mdx from '@mdx-js/rollup'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdxFrontmatter from 'remark-mdx-frontmatter'
import { defineConfig, type ProxyOptions } from 'vite'

function remarkMermaid() {
  return (tree: { children: Array<Record<string, unknown>> }) => {
    function visit(node: Record<string, unknown>) {
      const children = node.children as Array<Record<string, unknown>> | undefined
      if (!children) return
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (!child) continue
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

const configureBookingProxy =
  (publicSite: URL): NonNullable<ProxyOptions['configure']> =>
  (proxy) => {
    proxy.on('proxyReq', (proxyRequest, request) => {
      if (request.method === 'GET' || request.method === 'HEAD') return
      proxyRequest.setHeader('host', publicSite.host)
      proxyRequest.setHeader('origin', publicSite.origin)
      proxyRequest.setHeader('sec-fetch-site', 'same-origin')
    })
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

export default defineConfig(({ command, mode }) => {
  const workersShim = resolveWorkersShim(command, mode)
  const bookingDevOrigin = process.env.BOOKING_DEV_ORIGIN ?? 'http://localhost:3073'
  const publicSiteOrigin = process.env.PUBLIC_SITE_ORIGIN ?? 'http://localhost:3071'
  const publicSite = new URL(publicSiteOrigin)
  const bookingProxy =
    command === 'serve' && mode !== 'test'
      ? {
          '^/booking/[a-z0-9]+(?:-[a-z0-9]+)*(?:/|$)': {
            target: bookingDevOrigin,
            changeOrigin: true,
            configure: configureBookingProxy(publicSite)
          },
          '^/[a-z0-9]+(?:-[a-z0-9]+)*/booking(?:/|$)': {
            target: bookingDevOrigin,
            changeOrigin: true,
            configure: configureBookingProxy(publicSite)
          },
          '^/_booking/': { target: bookingDevOrigin, changeOrigin: true },
          '^/virtual:stylex\\.css$': { target: bookingDevOrigin, changeOrigin: true }
        }
      : undefined
  return {
    server: {
      port: 3071,
      host: true,
      // Quick Tunnels use a random subdomain. Restricting the suffix keeps
      // Vite's DNS-rebinding protection while allowing Cloudflare ingress.
      allowedHosts: ['.trycloudflare.com'],
      ...(bookingProxy ? { proxy: bookingProxy } : {})
    },
    preview: { port: 3071, host: true },
    resolve: {
      tsconfigPaths: true,
      alias: workersShim
        ? {
            'cloudflare:workers': resolve(import.meta.dirname, workersShim)
          }
        : {}
    },
    plugins: [
      devtools(),
      tailwindcss(),
      tanstackStart(),
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
              { theme: { dark: 'github-dark', light: 'github-light' } }
            ]
          ]
        })
      },
      viteReact()
    ],
    test: {
      globals: true,
      environment: 'jsdom',
      exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.output/**']
    }
  }
})
