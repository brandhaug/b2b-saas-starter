import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

const TOASTER_ICONS = {
  success: <CircleCheckIcon className="size-4" />,
  info: <InfoIcon className="size-4" />,
  warning: <TriangleAlertIcon className="size-4" />,
  error: <OctagonXIcon className="size-4" />,
  loading: <Loader2Icon className="size-4 motion-safe:animate-spin" />
}

// Sonner is themed through CSS custom properties, which `CSSProperties` alone
// cannot express.
type CssVariableStyle = React.CSSProperties & Record<`--${string}`, string>

const TOASTER_STYLE: CssVariableStyle = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius)'
}

const TOAST_OPTIONS = {
  classNames: {
    toast: 'cn-toast'
  }
}

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      // Fixed rather than read from a theme provider: the app is Catppuccin
      // Mocha in every context.
      theme="dark"
      className="toaster group"
      icons={TOASTER_ICONS}
      style={TOASTER_STYLE}
      toastOptions={TOAST_OPTIONS}
      {...props}
    />
  )
}

export { Toaster }
