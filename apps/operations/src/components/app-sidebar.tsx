'use client'

import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  Command,
  MessageSquareWarning,
  Search,
  ScrollText,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react'

import { NavMain } from '@/components/nav-main'
import { NavUser } from '@/components/nav-user'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'

const navigation = [
  { title: 'Discovery', url: '/', icon: Search },
  { title: 'Messaging', url: '/messaging', icon: MessageSquareWarning },
  { title: 'Operators', url: '/operators', icon: ShieldCheck },
  { title: 'Audit', url: '/audit', icon: ScrollText }
] satisfies {
  title: string
  url: '/' | '/messaging' | '/operators' | '/audit'
  icon: LucideIcon
}[]

const operator = {
  name: 'System Operator',
  email: 'Operations realm',
  avatar: ''
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="min-h-9"
              render={
                <Link
                  aria-label="Operations home"
                  search={{ merchantQuery: '', memberQuery: '' }}
                  to="/"
                />
              }
              size="lg"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Command className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Operations</span>
                <span className="truncate text-xs">Staff console</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navigation} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={operator} />
      </SidebarFooter>
    </Sidebar>
  )
}
