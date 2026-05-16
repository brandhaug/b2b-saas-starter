import type { ToasterProps } from 'sonner'

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

const TOASTER_ICONS = {
  success: <CircleCheckIcon className="size-4" />,
  info: <InfoIcon className="size-4" />,
  warning: <TriangleAlertIcon className="size-4" />,
  error: <OctagonXIcon className="size-4" />,
  loading: <Loader2Icon className="size-4 animate-spin" />
}

const TOASTER_STYLE = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius)'
} as React.CSSProperties

const TOAST_OPTIONS = {
  classNames: {
    toast: 'cn-toast'
  }
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()
  const resolvedTheme = theme ?? 'system'

  return (
    <Sonner
      theme={resolvedTheme as NonNullable<ToasterProps['theme']>}
      className="toaster group"
      icons={TOASTER_ICONS}
      style={TOASTER_STYLE}
      toastOptions={TOAST_OPTIONS}
      {...props}
    />
  )
}

export { Toaster }
