import { useState } from 'react'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useServerAction } from '@/hooks/use-server-action'
import { formatTimestamp } from '@/lib/format-date'
import {
  downloadPersonalDataServerFn,
  exportPersonalDataServerFn
} from '@/lib/server/account'
import { m } from '@b2b-saas-starter/i18n/messages'

export type PersonalDataExport = {
  readonly id: string
  readonly expiresAt: string
}

export type RequestPersonalDataExport = () => Promise<PersonalDataExport>
export type DownloadPersonalDataExport = (input: {
  readonly data: { readonly exportId: string }
}) => Promise<{ readonly fileName: string; readonly json: string }>

function requestExport(): Promise<PersonalDataExport> {
  return exportPersonalDataServerFn()
}

function downloadExport(input: {
  readonly data: { readonly exportId: string }
}): Promise<{ readonly fileName: string; readonly json: string }> {
  return downloadPersonalDataServerFn(input)
}

function saveDownload(fileName: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function PersonalDataExportPanel({
  request = requestExport,
  download = downloadExport
}: {
  readonly request?: RequestPersonalDataExport
  readonly download?: DownloadPersonalDataExport
}) {
  const [exported, setExported] = useState<PersonalDataExport | null>(null)
  const requestAction = useServerAction(() => request(), {
    failureMessage: m.personal_data_export_request_failed(),
    onSuccess: (value) => {
      setExported(value)
    },
    invalidate: false
  })
  const downloadAction = useServerAction(download, {
    failureMessage: m.personal_data_export_download_failed(),
    onSuccess: ({ fileName, json }) => {
      saveDownload(fileName, json)
    },
    invalidate: false
  })
  const failure = requestAction.error ?? downloadAction.error
  const pending = requestAction.pending || downloadAction.pending

  return (
    <section className="grid gap-4" aria-label={m.panel_personal_data()}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={exported === null ? 'default' : 'outline'}
          onClick={() => {
            requestAction.reset()
            downloadAction.reset()
            requestAction.run()
          }}
          disabled={pending}
        >
          {requestAction.pending ? <Spinner /> : null}
          {exported === null
            ? m.personal_data_request_export()
            : m.personal_data_request_new_export()}
        </Button>
        {exported === null ? null : (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              requestAction.reset()
              downloadAction.reset()
              downloadAction.run({ data: { exportId: exported.id } })
            }}
            disabled={pending}
          >
            {downloadAction.pending ? <Spinner /> : null}
            {m.personal_data_download_export()}
          </Button>
        )}
      </div>
      {exported === null ? null : (
        <p className="text-sm text-muted-foreground">
          {m.personal_data_available_until({
            time: formatTimestamp(exported.expiresAt, {
              dateStyle: 'medium',
              timeStyle: 'short'
            })
          })}
        </p>
      )}
      <ActionFeedback error={failure} />
    </section>
  )
}
