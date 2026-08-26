import { lazy } from 'react'

import { MdxLink } from '@/components/mdx-link'

// Mermaid's wrapper is lazy like its chart siblings, so nothing eager can
// sneak the (heavy) module graph into the docs/blog chunks.
const MdxMermaid = lazy(() =>
  import('@/components/mdx-mermaid').then((m) => ({ default: m.MdxMermaid }))
)

const MdxLineChart = lazy(() =>
  import('@/components/mdx-chart').then((m) => ({ default: m.MdxLineChart }))
)
const MdxBarChart = lazy(() =>
  import('@/components/mdx-chart').then((m) => ({ default: m.MdxBarChart }))
)
const MdxPieChart = lazy(() =>
  import('@/components/mdx-chart').then((m) => ({ default: m.MdxPieChart }))
)

export const mdxComponents = {
  a: MdxLink,
  MdxMermaid,
  MdxLineChart,
  MdxBarChart,
  MdxPieChart
}
