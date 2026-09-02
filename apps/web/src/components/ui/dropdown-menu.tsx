'use client'

import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { ChevronRightIcon } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, 'align' | 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal data-slot="dropdown-menu-portal">
      <MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="z-50">
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            // Motion is `motion-safe:`-gated; without it the menu simply
            // appears, like every other overlay in the app.
            'bg-popover text-popover-foreground data-open:motion-safe:animate-in data-closed:motion-safe:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:motion-safe:zoom-out-95 data-open:motion-safe:zoom-in-95 z-50 max-h-(--available-height) min-w-40 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-border p-1 shadow-md',
            className
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'focus-visible:bg-accent focus-visible:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 relative grid cursor-default grid-cols-[auto_1fr] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none [&_svg:not([class*=size-])]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuGroupLabel({
  className,
  ...props
}: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-group-label"
      className={cn('px-2 py-1.5 text-2xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('bg-border -mx-1 my-1 h-px', className)}
      {...props}
    />
  )
}

function DropdownMenuSubmenu(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-submenu" {...props} />
}

function DropdownMenuSubmenuTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-submenu-trigger"
      className={cn(
        'focus-visible:bg-accent focus-visible:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground grid cursor-default grid-cols-[auto_1fr_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none [&_svg:not([class*=size-])]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubmenuContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal data-slot="dropdown-menu-submenu-portal">
      <MenuPrimitive.Positioner
        align="start"
        side="right"
        sideOffset={sideOffset}
        className="z-50"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-submenu-content"
          className={cn(
            'bg-popover text-popover-foreground data-open:motion-safe:animate-in data-closed:motion-safe:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:motion-safe:zoom-out-95 data-open:motion-safe:zoom-in-95 z-50 max-h-(--available-height) min-w-40 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-border p-1 shadow-md',
            className
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuSeparator,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuTrigger,
  DropdownMenuSubmenuContent
}
