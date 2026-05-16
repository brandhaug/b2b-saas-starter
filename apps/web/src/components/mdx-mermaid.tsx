import { useEffect, useId, useRef } from 'react'

export function MdxMermaid({ chart }: { readonly chart: string }) {
  const id = useId().replaceAll(':', '_')
  const containerRef = useRef<HTMLDivElement>(null)

  const processedChart = chart.replaceAll('\\n', '<br/>')

  useEffect(() => {
    const cancelled = { current: false }

    async function renderChart() {
      const mermaid = (await import('mermaid')).default
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
    <div ref={containerRef} className="my-6 flex justify-center [&>svg]:max-w-full" />
  )
}
