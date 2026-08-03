import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type {
  CustomerImportRow,
  CustomerRecord
} from '@b2b-saas-starter/capabilities/customer-directory'
import {
  exportCustomers,
  importCustomers,
  previewCustomerImport
} from '@/lib/server/customer-directory.ts'
import { parseCustomerImportCsv } from './customer-directory-csv.ts'

const formValue = (data: FormData, field: string) => {
  const found = data.get(field)
  return typeof found === 'string' ? found.trim() : ''
}

const commandKey = () => crypto.randomUUID()

export function useCustomerDirectoryTransfer({
  records,
  reloadDirectory,
  setBusy,
  setMessage
}: {
  readonly records: readonly CustomerRecord[]
  readonly reloadDirectory: (includeArchived?: boolean) => Promise<void>
  readonly setBusy: Dispatch<SetStateAction<boolean>>
  readonly setMessage: Dispatch<SetStateAction<string | null>>
}) {
  const [importPreview, setImportPreview] = useState<{
    readonly fileId: string
    readonly idempotencyKey: string
    readonly rows: readonly CustomerImportRow[]
    readonly outcomes: readonly { readonly row: number; readonly outcome: string }[]
  } | null>(null)
  const importRows = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const rows =
      importPreview?.rows ??
      parseCustomerImportCsv(formValue(new FormData(form), 'rows'))
    if (rows.length === 0) return
    setBusy(true)
    if (!importPreview) {
      void previewCustomerImport({ data: { rows } })
        .then((preview) => {
          setImportPreview({
            fileId: commandKey(),
            idempotencyKey: commandKey(),
            rows,
            outcomes: preview
          })
          setMessage('Review the import outcomes, then confirm import.')
        })
        .catch(() => setMessage('Import preview could not be generated.'))
        .finally(() => setBusy(false))
      return
    }
    void importCustomers({
      data: {
        fileId: importPreview.fileId,
        idempotencyKey: importPreview.idempotencyKey,
        expectedRevisions: Object.fromEntries(
          records.map((record) => [record.id, record.revision])
        ),
        rows
      }
    })
      .then(async (result) => {
        await reloadDirectory()
        setMessage(
          `Import complete: ${result.created} created, ${result.matched} matched, ${result.rejected} rejected.`
        )
        setImportPreview(null)
        form.reset()
      })
      .catch(async () => {
        try {
          await reloadDirectory()
          setMessage(
            'The import was not confirmed. Directory revisions were reloaded; review the frozen preview before retrying.'
          )
        } catch {
          setMessage('Import could not be completed. Review the rows and retry.')
        }
      })
      .finally(() => setBusy(false))
  }
  const exportDirectory = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const exported = await exportCustomers()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
      )
      const download = document.createElement('a')
      download.href = url
      download.download = 'customer-directory.json'
      download.click()
      URL.revokeObjectURL(url)
      setMessage(`Exported ${exported.length} customer records.`)
    } catch {
      setMessage('Customer data could not be exported. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return { importPreview, setImportPreview, importRows, exportDirectory }
}
