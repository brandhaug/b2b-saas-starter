import { createClientOnlyFn } from '@tanstack/react-start'
import { useEffect, useId, useRef } from 'react'

import { MERMAID_THEME } from '@/components/mermaid-theme'

/**
 * The mermaid renderer, loaded only where it can run. Mermaid (and its
 * ~2.7 MB diagram/telemetry graph: cytoscape, katex, posthog-js) is pure
 * client-side: the SSR pass renders the empty figure and never executes the
 * library, and `createClientOnlyFn` swaps the loader for a stub in the
 * server build so the dynamic import never enters the server graph —
 * without this, the deploy build ships mermaid's lazy chunks to the Worker
 * it can never run them in (ADR 0063).
 */
const loadMermaid = createClientOnlyFn(async () => {
  const mermaidModule = await import('mermaid')
  const mermaid = mermaidModule.default
  mermaid.initialize({
    startOnLoad: false,
    // Fixed: the app has one scheme (Catppuccin Mocha), so there is no
    // theme class to watch for and re-render on. `base` + the token-mapped
    // MERMAID_THEME keeps diagrams on the app palette (stock `dark` shipped
    // edge labels at 4.43:1). `darkMode: true` makes the base theme resolve
    // its remaining dark-mode branches; without it the derived node label
    // styles fought the token-mapped colors.
    theme: 'base',
    darkMode: true,
    themeVariables: MERMAID_THEME,
    securityLevel: 'strict'
  })
  return mermaid
})

type Mermaid = Awaited<ReturnType<typeof loadMermaid>>

// One load shared by every diagram on the page: the ~780 kB graph is fetched
// the first time any chart approaches the viewport, not once per figure.
let mermaidPromise: Promise<Mermaid> | undefined

function getMermaid(): Promise<Mermaid> {
  mermaidPromise ??= loadMermaid()
  return mermaidPromise
}

/** The first line of a chart body that is not a directive or `%%` comment. */
const DIAGRAM_DECLARATION =
  /^(?:flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|architecture-beta|block-beta|packet-beta|kanban|sankey-beta|xychart-beta|radar-beta|C4Context)/u

/** Label cleanup: mermaid line breaks (`<br/>` and the literal `\n` escape)
 * become spaces so the alt text reads as one line. */
function cleanLabel(label: string, ...alsoStrip: ReadonlyArray<string>): string {
  let cleaned = label.replaceAll(String.raw`\n`, ' ').replaceAll('<br/>', ' ')
  for (const strip of alsoStrip) {
    cleaned = cleaned.replaceAll(strip, '')
  }
  return cleaned.trim()
}

/**
 * First human-readable fragment of one mermaid statement: a quoted label, a
 * bracketed node label, or the text after a message colon.
 */
function extractLabel(line: string): string | undefined {
  const quoted = /"([^"]+)"/u.exec(line)?.[1]
  if (quoted !== undefined && quoted.trim().length > 0) {
    const cleaned = cleanLabel(quoted)
    if (cleaned.length > 0) {
      return cleaned
    }
  }
  const bracketed = /\[([^\]]+)\]/u.exec(line)?.[1]
  if (bracketed !== undefined && bracketed.trim().length > 0) {
    const cleaned = cleanLabel(bracketed, '"')
    if (cleaned.length > 0) {
      return cleaned
    }
  }
  const message = /:\s*(.+)$/u.exec(line)?.[1]
  if (message !== undefined && message.trim().length > 0) {
    const cleaned = cleanLabel(message)
    if (cleaned.length > 0) {
      return cleaned
    }
  }
  return undefined
}

/**
 * Honest alt text from the chart's own source: a `title` directive when the
 * author wrote one, else the first label on the first body line. Nothing is
 * invented — a chart with no readable text stays "Diagram".
 */
function mermaidAltText(chart: string): string {
  const lines = chart
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('%%'))

  const title = lines.find((line) => line.startsWith('title '))
  if (title !== undefined) {
    return `Diagram: ${title.slice('title '.length).trim()}`
  }

  const first = DIAGRAM_DECLARATION.test(lines[0] ?? '') ? lines[1] : lines[0]
  const label = first === undefined ? undefined : extractLabel(first)
  return label === undefined ? 'Diagram' : `Diagram: ${label}`
}

export function MdxMermaid({ chart }: { readonly chart: string }) {
  const id = useId().replaceAll(':', '_')
  const containerRef = useRef<HTMLDivElement>(null)

  const processedChart = chart.replaceAll(String.raw`\n`, '<br/>')
  const altText = mermaidAltText(chart)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) {
      return
    }

    // Explicit annotation: the cleanup closure mutates this after return, so
    // control-flow analysis must not narrow it to `false`.
    let cancelled: boolean = false

    async function renderChart() {
      const mermaid = await getMermaid()
      const { svg } = await mermaid.render(`mermaid_${id}`, processedChart.trim())
      if (!cancelled && containerRef.current) {
        containerRef.current.innerHTML = svg
      }
    }

    // 780 kB is too much to load for a figure the reader may never scroll
    // to: the import starts when the diagram comes within 200px of the
    // viewport. Environments without IntersectionObserver (old browsers,
    // jsdom) keep the old mount-time behavior.
    if (!('IntersectionObserver' in window)) {
      void renderChart()
      return () => {
        cancelled = true
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          void renderChart()
        }
      },
      // Generous margin so the render usually completes before the figure
      // scrolls into view.
      { rootMargin: '200px' }
    )
    observer.observe(container)

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [processedChart, id])

  return (
    <figure className="not-prose my-6 overflow-x-auto">
      {/* Text alternative for screen readers — the rendered SVG is an image. */}
      <figcaption className="sr-only">{altText}</figcaption>
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
