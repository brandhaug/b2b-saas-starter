import { useEffect, useId, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useServerAction } from '@/hooks/use-server-action'
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
import { LocaleFlag } from '@/components/locale-flag'

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
  const save = useServerAction(
    (data: { locale: ReturnType<typeof getLocale>; timeZone: string }) =>
      setLocalePreferencesServerFn({ data }),
    {
      failureMessage: m.shell_save_error(),
      invalidate: false,
      onSuccess: async (_, { locale }) => {
        if (locale === getLocale()) {
          window.location.reload()
        } else {
          await setLocale(locale)
        }
      }
    }
  )
  const form = useForm({
    defaultValues: { locale: getLocale(), timeZone: presentationSettings().timeZone },
    onSubmit: async ({ value }) => {
      await save.runAsync(value)
    }
  })

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
            void form.handleSubmit()
          }
        }}
      >
        <form.Field name="locale">
          {(field) => (
            <div className="grid gap-2">
              <Label id={`${id}-language-label`} htmlFor={`${id}-language`}>
                {m.shell_language()}
              </Label>
              <Select
                value={field.state.value}
                disabled={!hydrated || save.pending}
                onValueChange={(value) => {
                  if (value !== null && isLocale(value)) {
                    field.handleChange(value)
                  }
                }}
              >
                <SelectTrigger
                  id={`${id}-language`}
                  aria-labelledby={`${id}-language-label`}
                  className="w-full pr-3 text-base sm:text-sm"
                >
                  <SelectValue>
                    <LocaleFlag locale={field.state.value} />
                    {field.state.value === 'nb' ? 'Norsk' : 'English'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="en">
                      <LocaleFlag locale="en" />
                      English
                    </SelectItem>
                    <SelectItem value="nb">
                      <LocaleFlag locale="nb" />
                      Norsk
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
        <form.Field name="timeZone">
          {(field) => (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-timezone`}>{m.shell_time_zone()}</Label>
              <Input
                id={`${id}-timezone`}
                name="timeZone"
                disabled={!hydrated || save.pending}
                value={field.state.value}
                required
                aria-describedby={`${id}-hint`}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                {m.shell_time_zone_hint()}
              </p>
            </div>
          )}
        </form.Field>
        {save.error ? (
          <p role="alert" className="text-sm text-destructive">
            {save.error}
          </p>
        ) : null}
        <Button type="submit" disabled={!hydrated || save.pending}>
          {save.pending ? m.shell_saving() : m.shell_save()}
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
            <AlertDialogAction
              disabled={save.pending}
              onClick={() => void form.handleSubmit()}
            >
              {m.shell_save()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  )
}
