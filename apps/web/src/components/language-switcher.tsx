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
  AlertDialogCancel,
  AlertDialogFooter
} from '@/components/ui/alert-dialog'
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
import { hasEditedForms } from '@/lib/unsaved-form'
import { useServerAction } from '@/hooks/use-server-action'
import { setLocalePreferencesServerFn } from '@/lib/server/account-preferences'
import { LocaleFlag } from '@/components/locale-flag'
import { usePreview } from '@/lib/preview-context'

export function LanguageSwitcher() {
  const preview = usePreview()
  const hydrated = useClientValue(() => true, false)
  const [pending, setPending] = useState<Locale | null>(null)
  const switchLanguage = useServerAction(
    (locale: Locale) => setLocalePreferencesServerFn({ data: { locale } }),
    {
      failureMessage: m.shell_save_error(),
      invalidate: false,
      onSuccess: async (_, locale) => {
        await setLocale(locale)
      }
    }
  )
  function selectLanguage(locale: Locale) {
    if (preview || !presentationSettings().authenticated) {
      void setLocale(locale)
    } else {
      switchLanguage.run(locale)
    }
  }

  return (
    <div data-locale-control className="grid gap-1">
      <Select
        value={getLocale()}
        disabled={!hydrated || switchLanguage.pending}
        onValueChange={(value) => {
          if (value === null) {
            return
          }
          const locale = value
          if (!isLocale(locale) || locale === getLocale()) {
            return
          }
          if (hasEditedForms()) {
            setPending(locale)
          } else {
            selectLanguage(locale)
          }
        }}
      >
        <SelectTrigger
          aria-label={m.shell_language()}
          className="min-w-32 max-w-40 pr-3 text-base sm:text-xs"
        >
          <SelectValue>
            <LocaleFlag locale={getLocale()} />
            {getLocale() === 'nb' ? 'Norsk' : 'English'}
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
      {switchLanguage.error ? (
        <p role="alert" className="text-xs text-destructive">
          {switchLanguage.error}
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
          <AlertDialogFooter>
            <AlertDialogCancel>{m.shell_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              disabled={switchLanguage.pending}
              onClick={() => {
                if (pending) {
                  selectLanguage(pending)
                }
              }}
            >
              {m.shell_switch()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
