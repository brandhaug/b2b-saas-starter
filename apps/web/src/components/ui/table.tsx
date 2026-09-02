'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

function Table({
  className,
  'aria-label': label,
  ...props
}: React.ComponentProps<'table'>) {
  // The scroll wrapper is a named, focusable region: keyboard users can pan a
  // table wider than the viewport (axe: scrollable-region-focusable), instead
  // of columns clipping mid-word with no way to reach them. The label lives
  // on the region (the table is inside it, so it is announced once).
  return (
    // oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-tabindex -- a <section> would imply a document outline entry, and the tabindex is what makes the scroll region keyboard-pannable
    <div
      data-slot="table-container"
      role="region"
      aria-label={label ?? 'Data table'}
      tabIndex={0}
      className="relative w-full overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        'text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell }
