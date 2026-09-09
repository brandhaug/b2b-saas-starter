import { useEffect, useId, useState } from 'react'
import * as m from '@b2b-saas-starter/i18n/messages'
import { getLocale, setLocale } from '@b2b-saas-starter/i18n/runtime'
import { isLocale } from '@b2b-saas-starter/i18n/locale'
import { Panel } from '@/components/page/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useClientValue } from '@/lib/client-only-value'
import { presentationSettings } from '@/lib/i18n'
import { hasEditedForms, trackFormEdits } from '@/lib/unsaved-form'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter
} from '@/components/ui/alert-dialog'
import { callServerFn } from '@/lib/server-call'
import { setLocalePreferencesServerFn } from '@/lib/server/account-preferences'

/** Time-zone detection happens after hydration and never overwrites a preference. */
export function LocaleBootstrap() {
  useEffect(() => {
    const stopTracking = trackFormEdits()
    const settings = presentationSettings()
    if (settings.authenticated && settings.needsTimeZone) {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      void callServerFn(
        () =>
          setLocalePreferencesServerFn({
            data: { timeZone, initializeTimeZone: true }
          }),
        m.shell_save_error()
      ).then((result) => {
        if (result.ok) {
          document.documentElement.dataset.needsTimeZone = 'false'
        }
        return null
      })
    }
    return stopTracking
  }, [])
  return null
}

export function LocalePreferences() {
  const hydrated = useClientValue(() => true, false)
  const id = useId()
  const [confirming, setConfirming] = useState(false)
  const [selectedLocale, setSelectedLocale] = useState(getLocale)
  const [timeZone, setTimeZone] = useState(() => presentationSettings().timeZone)
  const [status, setStatus] = useState<'idle' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setStatus('saving')
    setError(null)
    const result = await callServerFn(
      () =>
        setLocalePreferencesServerFn({ data: { locale: selectedLocale, timeZone } }),
      m.shell_save_error()
    )
    if (!result.ok) {
      setError(result.message)
      setStatus('idle')
      return
    }
    if (selectedLocale === getLocale()) {
      window.location.reload()
    } else {
      await setLocale(selectedLocale)
    }
  }

  return (
    <Panel
      title={m.shell_preferences()}
      description={m.shell_preferences_description()}
    >
      <form
        className="grid max-w-md gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (hasEditedForms(event.currentTarget)) {
            setConfirming(true)
          } else {
            void save()
          }
        }}
      >
        <div className="grid gap-2">
          <Label id={`${id}-language-label`} htmlFor={`${id}-language`}>
            {m.shell_language()}
          </Label>
          <Select
            value={selectedLocale}
            disabled={!hydrated || status === 'saving'}
            onValueChange={(value) => {
              if (value !== null && isLocale(value)) {
                setSelectedLocale(value)
              }
            }}
          >
            <SelectTrigger
              id={`${id}-language`}
              aria-labelledby={`${id}-language-label`}
              className="w-full pr-3 text-base sm:text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="nb">Norsk bokmål</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-timezone`}>{m.shell_time_zone()}</Label>
          <Input
            id={`${id}-timezone`}
            name="timeZone"
            disabled={!hydrated || status === 'saving'}
            value={timeZone}
            required
            aria-describedby={`${id}-hint`}
            onChange={(event) => setTimeZone(event.target.value)}
          />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {m.shell_time_zone_hint()}
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={!hydrated || status === 'saving'}>
          {status === 'saving' ? m.shell_saving() : m.shell_save()}
        </Button>
      </form>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>{m.shell_preferences_reload_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.shell_preferences_reload_description()}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.shell_cancel()}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save()}>
              {m.shell_save()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  )
}
