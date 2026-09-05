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

// Success and warning paint from the same status tokens as badges and alerts
// (`--status-*` in index.css), so a state is one hue everywhere. Ink values
// are the near-black crust, matching how primary-foreground sits on primary.
const TOASTER_STYLE: CssVariableStyle = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--success-bg': 'var(--status-ok)',
  '--success-text': 'var(--primary-foreground)',
  '--success-border': 'var(--status-ok)',
  '--warning-bg': 'var(--status-warn)',
  '--warning-text': 'var(--primary-foreground)',
  '--warning-border': 'var(--status-warn)',
  '--error-bg': 'var(--destructive)',
  '--error-text': 'var(--destructive-foreground)',
  '--error-border': 'var(--destructive)',
  '--info-bg': 'var(--status-info)',
  '--info-text': 'var(--primary-foreground)',
  '--info-border': 'var(--status-info)',
  // Same interactive radius as buttons/inputs (`rounded-md`), not a third
  // value: `--radius-md` is calc(var(--radius) - 2px) = 6px.
  '--border-radius': 'var(--radius-md)'
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
