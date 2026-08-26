import { type AnchorHTMLAttributes } from 'react'
import { type MDXComponents } from 'mdx/types'

import { Link } from '@tanstack/react-router'

export type MdxComponentProps = {
  readonly components?: MDXComponents
}

type MdxLinkProps = AnchorHTMLAttributes<HTMLAnchorElement>

export function MdxLink({ href, children, className }: MdxLinkProps) {
  if (!href) {
    return <span className={className}>{children}</span>
  }

  const isAnchor = href.startsWith('#')

  if (isAnchor) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    )
  }

  if (href.startsWith('/')) {
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
