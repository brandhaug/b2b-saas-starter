import { useState } from 'react'
import * as m from '@b2b-saas-starter/i18n/messages'
import { isLocale, type Locale } from '@b2b-saas-starter/i18n/locale'
import { getLocale, setLocale } from '@b2b-saas-starter/i18n/runtime'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel
} from '@/components/ui/alert-dialog'
import { useClientValue } from '@/lib/client-only-value'
import { presentationSettings } from '@/lib/i18n'
import { hasEditedForms } from '@/lib/unsaved-form'
import { callServerFn } from '@/lib/server-call'
import { setLocalePreferencesServerFn } from '@/lib/server/account-preferences'

export function LanguageSwitcher() {
  const hydrated = useClientValue(() => true, false)
  const [pending, setPending] = useState<Locale | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function switchLanguage(locale: Locale) {
    setStatus('saving')
    setError(null)
    if (presentationSettings().authenticated) {
      const result = await callServerFn(
        () => setLocalePreferencesServerFn({ data: { locale } }),
        m.shell_save_error()
      )
      if (!result.ok) {
        setError(result.message)
        setStatus('idle')
        return
      }
    }
    await setLocale(locale)
  }

  return (
    <div data-locale-control className="grid gap-1">
      <select
        aria-label={m.shell_language()}
        className="h-8 max-w-40 rounded-none border border-input bg-background px-2 text-base text-foreground sm:text-xs"
        value={getLocale()}
        disabled={!hydrated || status === 'saving'}
        onChange={(event) => {
          const locale = event.target.value
          if (!isLocale(locale) || locale === getLocale()) {
            return
          }
          if (hasEditedForms()) {
            setPending(locale)
          } else {
            void switchLanguage(locale)
          }
        }}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="nb" lang="nb">
          Norsk bokmål
        </option>
      </select>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{m.shell_unsaved_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.shell_unsaved_description()}
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>{m.shell_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) {
                  void switchLanguage(pending)
                }
              }}
            >
              {m.shell_switch()}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
