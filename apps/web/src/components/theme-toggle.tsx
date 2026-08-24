import { MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useHydrated } from '@/lib/client-only-value'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useHydrated()
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
  const label = mounted ? `Switch to ${nextTheme} mode` : 'Toggle theme'
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setTheme(nextTheme)}
      aria-label={label}
    >
      <SunIcon className="hidden size-4 dark:block" />
      <MoonIcon className="block size-4 dark:hidden" />
    </Button>
  )
}
