import { type ReactNode } from 'react'
import { Tabs } from '@base-ui/react/tabs'

/** Named views with keyboard navigation and persistent form state. */
export function SectionTabs({
  defaultValue,
  sections
}: {
  readonly defaultValue: string
  readonly sections: ReadonlyArray<{
    readonly value: string
    readonly label: string
    readonly content: ReactNode
    readonly keepMounted?: boolean
  }>
}) {
  const firstSection = sections[0]
  if (sections.length === 1 && firstSection !== undefined) {
    return firstSection.content
  }
  return (
    <Tabs.Root defaultValue={defaultValue} className="grid min-w-0 gap-6">
      <Tabs.List className="flex gap-1 overflow-x-auto border-b border-border">
        {sections.map(({ value, label }) => (
          <Tabs.Tab
            key={value}
            value={value}
            className="min-h-11 shrink-0 border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring data-active:border-primary data-active:text-foreground"
          >
            {label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {sections.map(({ value, content, keepMounted = true }) => (
        <Tabs.Panel
          key={value}
          value={value}
          keepMounted={keepMounted}
          className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  )
}
