import type { AnchorHTMLAttributes } from 'react'
import type { MDXComponents } from 'mdx/types'

import { Link } from '@tanstack/react-router'

export interface MdxComponentProps {
  readonly components?: MDXComponents
}

type MdxLinkProps = AnchorHTMLAttributes<HTMLAnchorElement>

export function MdxLink({ href, children, className }: MdxLinkProps) {
  if (!href) {
    return <span className={className}>{children}</span>
  }

  const isInternal = href.startsWith('/') || href.startsWith('#')

  if (isInternal) {
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    )
  }

  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}
