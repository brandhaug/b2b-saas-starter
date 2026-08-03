import { useEffect, useMemo, useRef, useState } from 'react'
import type { MerchantMessagingSettingsProjection } from '@b2b-saas-starter/capabilities/notifications'

export type MerchantMessagingSettingsSaveInput = {
  readonly enabled: boolean
  readonly confirmationEnabled: boolean
  readonly rescheduleEnabled: boolean
  readonly cancellationEnabled: boolean
  readonly reminderEnabled: boolean
  readonly reminderLeadHours: 2 | 24 | 48
}

const purposes = [
  ['appointment_confirmation', 'confirmation'],
  ['appointment_reschedule', 'reschedule'],
  ['appointment_cancellation', 'cancellation'],
  ['appointment_reminder', 'reminder']
] as const

export function MerchantMessagingSettingsLoading() {
  return (
    <output className="block p-6 text-sm text-muted-foreground">
      Loading notification settings…
    </output>
  )
}

export function MerchantMessagingSettingsLoadError() {
  return (
    <div role="alert" className="p-6 text-sm text-destructive">
      Notification settings are unavailable. Try again.
    </div>
  )
}

export function MerchantMessagingSettingsPanel({
  initial,
  save
}: {
  readonly initial: MerchantMessagingSettingsProjection
  readonly save: (
    input: MerchantMessagingSettingsSaveInput
  ) => Promise<MerchantMessagingSettingsProjection>
}) {
  const [saved, setSaved] = useState(initial)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [controls, setControls] = useState(initial.controls)
  const [reminderLeadHours, setReminderLeadHours] = useState<2 | 24 | 48>(
    initial.reminderLeadHours
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewPurpose, setPreviewPurpose] = useState<
    (typeof purposes)[number][0] | null
  >(null)
  const [previewLocale, setPreviewLocale] = useState<'ro' | 'en'>('ro')
  const previewDialog = useRef<HTMLDialogElement>(null)
  const disabled = pending || saved.frozen
  const dirty =
    enabled !== saved.enabled ||
    reminderLeadHours !== saved.reminderLeadHours ||
    Object.entries(controls).some(
      ([purpose, decision]) =>
        decision !== saved.controls[purpose as keyof typeof saved.controls]
    )
  const preview = useMemo(
    () =>
      saved.previews.find(
        (candidate) =>
          candidate.purpose === previewPurpose && candidate.locale === previewLocale
      ),
    [previewLocale, previewPurpose, saved.previews]
  )

  useEffect(() => {
    const dialog = previewDialog.current
    if (!dialog || !previewPurpose) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
    }
  }, [previewPurpose])

  const commit = async () => {
    setPending(true)
    setError(null)
    try {
      const next = await save({
        enabled,
        confirmationEnabled: controls.confirmation === 'send',
        rescheduleEnabled: controls.reschedule === 'send',
        cancellationEnabled: controls.cancellation === 'send',
        reminderEnabled: controls.reminder === 'send',
        reminderLeadHours
      })
      setSaved(next)
      setEnabled(next.enabled)
      setControls(next.controls)
      setReminderLeadHours(next.reminderLeadHours)
    } catch {
      setError('Notification settings could not be saved. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      data-merchant-messaging-settings="true"
      className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-5 sm:px-6"
    >
      {saved.state === 'needs_configuration' ? (
        <output className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="font-medium">Messaging needs configuration</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You can review and save these controls. Messages remain unavailable until
            platform configuration is complete.
          </p>
        </output>
      ) : null}
      {saved.state === 'disabled' ? (
        <output className="rounded-xl border border-border bg-muted/50 p-4">
          <p className="font-medium">Messaging is temporarily disabled</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved controls are read-only while this safety restriction is active.
          </p>
        </output>
      ) : null}

      <label className="flex min-h-14 items-center justify-between gap-4 rounded-2xl border border-border p-4">
        <span>
          <span className="block font-medium">Operational Messaging</span>
          <span className="block text-sm text-muted-foreground">
            Send customer Appointment updates by text.
          </span>
        </span>
        <input
          aria-label="Enable Operational Messaging"
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          className="size-5"
        />
      </label>

      <div className="overflow-hidden rounded-2xl border border-border">
        {purposes.map(([purpose, key]) => (
          <fieldset
            key={purpose}
            disabled={disabled}
            className="border-b border-border p-4 last:border-b-0"
          >
            <legend className="mb-3 capitalize font-medium">{key}</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['send', 'dont_send'] as const).map((decision) => (
                <label
                  key={decision}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-border px-3 text-sm has-checked:border-foreground has-checked:bg-muted"
                >
                  <input
                    className="sr-only"
                    type="radio"
                    name={key}
                    value={decision}
                    checked={controls[key] === decision}
                    onChange={() =>
                      setControls((current) => ({ ...current, [key]: decision }))
                    }
                  />
                  {decision === 'send' ? 'Send' : "Don't send"}
                </label>
              ))}
            </div>
            {purpose === 'appointment_reminder' ? (
              <label className="mt-4 block text-sm">
                <span className="mb-2 block text-muted-foreground">
                  Send before the Appointment
                </span>
                <select
                  value={reminderLeadHours}
                  disabled={disabled || controls.reminder === 'dont_send'}
                  onChange={(event) =>
                    setReminderLeadHours(
                      Number(event.currentTarget.value) as 2 | 24 | 48
                    )
                  }
                  className="min-h-11 w-full rounded-xl border border-border bg-background px-3"
                >
                  <option value={2}>2 hours</option>
                  <option value={24}>24 hours</option>
                  <option value={48}>48 hours</option>
                </select>
                <span className="mt-2 block text-xs text-muted-foreground">
                  Delivery window: {saved.deliveryWindow}
                </span>
              </label>
            ) : null}
            <button
              type="button"
              className="mt-3 min-h-11 text-sm font-medium underline underline-offset-4"
              onClick={() => {
                setPreviewPurpose(purpose)
                setPreviewLocale('ro')
              }}
            >
              Preview {key}
            </button>
          </fieldset>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={disabled || !dirty}
        onClick={() => void commit()}
        className="min-h-12 w-full rounded-xl bg-foreground px-4 font-medium text-background disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save notification settings'}
      </button>

      {previewPurpose ? (
        <dialog
          ref={previewDialog}
          aria-label="Read-only notification template preview"
          onCancel={(event) => {
            event.preventDefault()
            setPreviewPurpose(null)
          }}
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg rounded-2xl border border-border bg-background p-5 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:-translate-x-1/2"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Template preview</h2>
            <button
              type="button"
              className="min-h-11 px-2"
              onClick={() => setPreviewPurpose(null)}
            >
              Close
            </button>
          </div>
          <div className="my-3 flex gap-2" aria-label="Preview language">
            {(['ro', 'en'] as const).map((locale) => (
              <button
                key={locale}
                type="button"
                aria-pressed={previewLocale === locale}
                className="min-h-11 rounded-lg border border-border px-4"
                onClick={() => setPreviewLocale(locale)}
              >
                {locale === 'ro' ? 'Română' : 'English'}
              </button>
            ))}
          </div>
          <p className="rounded-xl bg-muted p-4 text-sm leading-6">
            {preview?.body ?? 'Preview unavailable.'}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Platform-controlled example using Appointment facts. Read only.
          </p>
        </dialog>
      ) : null}
    </section>
  )
}
