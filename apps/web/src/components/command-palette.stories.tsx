import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'

function CommandPalettePreview() {
  return (
    <div className="w-[28rem] overflow-hidden rounded-lg border border-border bg-popover shadow-md">
      <Command>
        <CommandInput placeholder="Search docs, pages, and actions..." />
        <CommandList>
          <CommandEmpty>No result found.</CommandEmpty>
          <CommandGroup heading="Public pages">
            <CommandItem>Pricing</CommandItem>
            <CommandItem>Docs</CommandItem>
            <CommandItem>Changelog</CommandItem>
            <CommandItem>FAQ</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Workspace">
            <CommandItem>Open Starter Lab</CommandItem>
            <CommandItem>Open admin dashboard</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}

const meta = {
  title: 'Navigation/CommandPalette',
  component: CommandPalettePreview
} satisfies Meta<typeof CommandPalettePreview>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
