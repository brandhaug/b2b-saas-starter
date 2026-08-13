import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

const TOASTER_ICONS = {
  success: <CircleCheckIcon className="size-4" />,
  info: <InfoIcon className="size-4" />,
  warning: <TriangleAlertIcon className="size-4" />,
  error: <OctagonXIcon className="size-4" />,
  loading: <Loader2Icon className="size-4 animate-spin" />
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

// next-themes types its active theme as a plain string, so it is narrowed to
// Sonner's contract here rather than asserted onto it.
function toToasterTheme(theme: string | undefined): NonNullable<ToasterProps['theme']> {
  if (theme === 'light' || theme === 'dark') return theme
  return 'system'
}

function Toaster({ ...props }: ToasterProps) {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={toToasterTheme(theme)}
      className="toaster group"
      icons={TOASTER_ICONS}
      style={TOASTER_STYLE}
      toastOptions={TOAST_OPTIONS}
      {...props}
    />
  )
}

export { Toaster }
