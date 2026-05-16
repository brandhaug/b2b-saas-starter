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
import { defineConfig } from 'vite'

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

export default defineConfig(({ mode }) => {
  const useWorkersShim =
    mode === 'test' || process.env.B2B_STARTER_USE_WORKERS_SHIM === '1'
  return {
    server: { port: 3071, host: 'localhost' },
    preview: { port: 3071, host: 'localhost' },
    resolve: {
      tsconfigPaths: true,
      alias: useWorkersShim
        ? {
            'cloudflare:workers': resolve(
              import.meta.dirname,
              './src/lib/cloudflare-workers-shim.ts'
            )
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
