import { useEffect, useId, useRef } from 'react'

export function MdxMermaid({ chart }: { readonly chart: string }) {
  const id = useId().replaceAll(':', '_')
  const containerRef = useRef<HTMLDivElement>(null)

  const processedChart = chart.replaceAll(String.raw`\n`, '<br/>')

  useEffect(() => {
    const cancelled = { current: false }

    async function renderChart() {
      const mermaidModule = await import('mermaid')
      const mermaid = mermaidModule.default
      const isDark = document.documentElement.classList.contains('dark')

      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'strict'
      })

      const { svg } = await mermaid.render(`mermaid_${id}`, processedChart.trim())
      if (!cancelled.current && containerRef.current) {
        containerRef.current.innerHTML = svg
      }
    }

    void renderChart()

    const observer = new MutationObserver(() => {
      void renderChart()
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

    return () => {
      cancelled.current = true
      observer.disconnect()
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
