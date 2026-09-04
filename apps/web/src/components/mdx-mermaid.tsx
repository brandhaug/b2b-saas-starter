import { createIsomorphicFn } from '@tanstack/react-start'
import { useEffect, useId, useRef } from 'react'

/**
 * The mermaid renderer, loaded only where it can run. Mermaid (and its
 * ~2.7 MB diagram/telemetry graph: cytoscape, katex, posthog-js) is pure
 * client-side: the SSR pass renders the empty figure and never executes the
 * library, so the `.server` half is an explicit none and the compiler strips
 * the dynamic import from the server bundle — without this, the deploy build
 * ships mermaid's lazy chunks to the Worker it can never run them in.
 */
const loadMermaid = createIsomorphicFn()
  .server(() => undefined)
  .client(async () => {
    const mermaidModule = await import('mermaid')
    return mermaidModule.default
  })

export function MdxMermaid({ chart }: { readonly chart: string }) {
  const id = useId().replaceAll(':', '_')
  const containerRef = useRef<HTMLDivElement>(null)

  const processedChart = chart.replaceAll(String.raw`\n`, '<br/>')

  useEffect(() => {
    const cancelled = { current: false }

    async function renderChart() {
      const mermaid = await loadMermaid()
      if (!mermaid) {
        return
      }

      mermaid.initialize({
        startOnLoad: false,
        // Fixed: the app has one scheme (Catppuccin Mocha), so there is no
        // theme class to watch for and re-render on.
        theme: 'dark',
        securityLevel: 'strict'
      })

      const { svg } = await mermaid.render(`mermaid_${id}`, processedChart.trim())
      if (!cancelled.current && containerRef.current) {
        containerRef.current.innerHTML = svg
      }
    }

    void renderChart()

    return () => {
      cancelled.current = true
    }
  }, [processedChart, id])

  return (
    <figure className="not-prose my-6 overflow-x-auto">
      {/* Text alternative for screen readers — the rendered SVG is an image. */}
      <figcaption className="sr-only">Diagram</figcaption>
      <div
        ref={containerRef}
        /* max-w-full keeps wide diagrams inside the column; h-auto stops the
           SVG from distorting when it shrinks, and the scroll container above
           absorbs anything narrower than its intrinsic width can render. */
        className="flex min-w-fit justify-center [&>svg]:h-auto [&>svg]:max-w-full"
      />
    </figure>
  )
}
