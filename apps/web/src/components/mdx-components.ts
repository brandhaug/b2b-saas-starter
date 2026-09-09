import { lazy } from 'react'

import { MdxLink } from '@/components/mdx-link'

// Mermaid's wrapper is lazy so nothing eager can sneak the (heavy) module
// graph into the docs chunk.
const MdxMermaid = lazy(() =>
  import('@/components/mdx-mermaid').then((m) => ({ default: m.MdxMermaid }))
)

export const mdxComponents = {
  a: MdxLink,
  MdxMermaid
}
