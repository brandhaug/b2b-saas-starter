import { lazy } from 'react'

import { MdxLink } from '@/components/mdx-link'
import { MdxMermaid } from '@/components/mdx-mermaid'

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
