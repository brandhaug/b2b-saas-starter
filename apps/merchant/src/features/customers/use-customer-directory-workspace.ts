import { useMemo, useState, type FormEvent } from 'react'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import {
  addCustomerNote,
  archiveCustomer,
  banCustomer,
  editCustomerPreferred,
  exportCustomers,
  importCustomers,
  liftCustomerBan,
  mergeCustomers,
  previewCustomerImport,
  recordCustomerConsent,
  searchCustomerRecords,
  setCustomerContactStatus,
  splitCustomer
} from '@/lib/server/customer-directory.ts'
import { filterCustomerEntries } from './customer-contact-model.ts'
import { parseCustomerImportCsv } from './customer-directory-csv.ts'

const formValue = (data: FormData, field: string) => {
  const found = data.get(field)
  return typeof found === 'string' ? found.trim() : ''
}

const commandKey = () => crypto.randomUUID()

export const useCustomerDirectoryWorkspace = (
  initialRecords: readonly CustomerRecord[]
) => {
  const [records, setRecords] = useState(initialRecords)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(initialRecords[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<{
    readonly rows: readonly {
      readonly name: string
      readonly email: string | null
      readonly phone: string | null
    }[]
    readonly outcomes: readonly { readonly row: number; readonly outcome: string }[]
  } | null>(null)
  const visible = useMemo(() => filterCustomerEntries(records, query), [query, records])
  const selected = records.find((record) => record.id === selectedId) ?? null
  const possibleDuplicates = selected
    ? records.filter(
        (record) =>
          record.status === 'active' &&
          record.id !== selected.id &&
          (selected.possibleDuplicateOf.includes(record.id) ||
            record.possibleDuplicateOf.includes(selected.id))
      )
    : []

  const replace = (record: CustomerRecord) => {
    setRecords((current) =>
      current.map((candidate) => (candidate.id === record.id ? record : candidate))
    )
    setSelectedId(record.id)
  }
  const reloadDirectory = async () => {
    const authoritative = await searchCustomerRecords({
      data: { query: '', includeArchived: true }
    })
    setRecords(authoritative)
    setSelectedId((current) =>
      current && authoritative.some((record) => record.id === current)
        ? current
        : (authoritative[0]?.id ?? null)
    )
  }
  const run = async (operation: () => Promise<CustomerRecord>) => {
    setBusy(true)
    setMessage(null)
    try {
      replace(await operation())
      setMessage('Saved')
      return true
    } catch {
      try {
        await reloadDirectory()
        setMessage(
          'The save was not confirmed. The authoritative directory was reloaded; review the retained input before retrying.'
        )
      } catch {
        setMessage('The record changed or could not be saved. Refresh and try again.')
      }
      return false
    } finally {
      setBusy(false)
    }
  }

  const edit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    void run(() =>
      editCustomerPreferred({
        data: {
          recordId: selected.id,
          expectedRevision: selected.revision,
          idempotencyKey: commandKey(),
          name: formValue(data, 'name'),
          email: formValue(data, 'email') || null,
          phone: formValue(data, 'phone') || null
        }
      })
    )
  }
  const note = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    const form = event.currentTarget
    const text = formValue(new FormData(form), 'note')
    if (!text) return
    void run(() =>
      addCustomerNote({
        data: {
          recordId: selected.id,
          expectedRevision: selected.revision,
          idempotencyKey: commandKey(),
          text
        }
      })
    ).then((saved) => {
      if (saved) form.reset()
    })
  }
  const ban = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    void run(() =>
      banCustomer({
        data: {
          recordId: selected.id,
          expectedRevision: selected.revision,
          idempotencyKey: commandKey(),
          reason: formValue(data, 'reason'),
          expiresAt: formValue(data, 'expiresAt') || null
        }
      })
    )
  }
  const merge = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    const absorbed = records.find(
      (record) => record.id === formValue(data, 'absorbedId')
    )
    if (!absorbed) return
    setBusy(true)
    setMessage(null)
    void mergeCustomers({
      data: {
        survivorId: selected.id,
        absorbedId: absorbed.id,
        expectedSurvivorRevision: selected.revision,
        expectedAbsorbedRevision: absorbed.revision,
        idempotencyKey: commandKey(),
        preferredDetailsSourceId:
          formValue(data, 'preferredDetailsSourceId') || selected.id,
        reason: formValue(data, 'reason')
      }
    })
      .then((saved) => {
        replace(saved)
        setRecords((current) => current.filter((record) => record.id !== absorbed.id))
        setMessage('Saved')
      })
      .catch(async () => {
        try {
          await reloadDirectory()
          setMessage(
            'The merge was not confirmed. Both records were reloaded; review them before retrying.'
          )
        } catch {
          setMessage(
            'The records changed or could not be merged. Refresh and try again.'
          )
        }
      })
      .finally(() => setBusy(false))
  }
  const split = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    const observationIds = data
      .getAll('observationId')
      .filter((entry): entry is string => typeof entry === 'string')
    const noteIds = data
      .getAll('noteId')
      .filter((entry): entry is string => typeof entry === 'string')
    const consentIds = data
      .getAll('consentId')
      .filter((entry): entry is string => typeof entry === 'string')
    const selectedContactKeys = new Set(
      data
        .getAll('contactKey')
        .filter((entry): entry is string => typeof entry === 'string')
    )
    const contactKeys = selected.contacts
      .filter((contact) => selectedContactKeys.has(`${contact.kind}:${contact.value}`))
      .map(({ kind, value }) => ({ kind, value }))
    if (observationIds.length === 0) return
    setBusy(true)
    setMessage(null)
    void splitCustomer({
      data: {
        sourceId: selected.id,
        observationIds,
        expectedRevision: selected.revision,
        idempotencyKey: commandKey(),
        createdDetails: {
          name: formValue(data, 'createdName'),
          email: formValue(data, 'createdEmail') || null,
          phone: formValue(data, 'createdPhone') || null
        },
        contactKeys,
        noteIds,
        consentIds,
        reason: formValue(data, 'reason')
      }
    })
      .then(({ source, created }) => {
        setRecords((current) => [
          ...current.map((record) => (record.id === source.id ? source : record)),
          created
        ])
        setSelectedId(created.id)
        setMessage('Split saved')
      })
      .catch(async () => {
        try {
          await reloadDirectory()
          setMessage(
            'The split was not confirmed. The directory was reloaded; review the retained assignments before retrying.'
          )
        } catch {
          setMessage('The record changed or could not be split. Refresh and try again.')
        }
      })
      .finally(() => setBusy(false))
  }
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
          setImportPreview({ rows, outcomes: preview })
          setMessage('Review the import outcomes, then confirm import.')
        })
        .catch(() => setMessage('Import preview could not be generated.'))
        .finally(() => setBusy(false))
      return
    }
    void importCustomers({
      data: {
        fileId: commandKey(),
        idempotencyKey: commandKey(),
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
  const setContactStatus = (
    contact: CustomerRecord['contacts'][number],
    status: 'active' | 'disputed',
    preferred: boolean
  ) => {
    if (!selected) return
    void run(() =>
      setCustomerContactStatus({
        data: {
          recordId: selected.id,
          expectedRevision: selected.revision,
          idempotencyKey: commandKey(),
          kind: contact.kind,
          value: contact.value,
          status,
          preferred
        }
      })
    )
  }
  const recordConsent = (withdrawn: boolean) => {
    if (!selected?.preferredPhone) return
    void run(() =>
      recordCustomerConsent({
        data: {
          recordId: selected.id,
          expectedRevision: selected.revision,
          idempotencyKey: commandKey(),
          purpose: 'operational_mobile',
          destination: selected.preferredPhone!,
          wordingVersion: 'merchant-recorded-v1',
          source: 'merchant_directory',
          withdrawn
        }
      })
    )
  }
  const liftBan = () => {
    if (!selected) return
    void run(() =>
      liftCustomerBan({
        data: {
          recordId: selected.id,
          expectedRevision: selected.revision,
          idempotencyKey: commandKey(),
          reason: 'Owner lifted ban'
        }
      })
    )
  }
  const toggleArchive = () => {
    if (!selected) return
    void run(() =>
      archiveCustomer({
        data: {
          recordId: selected.id,
          expectedRevision: selected.revision,
          idempotencyKey: commandKey(),
          archived: selected.status !== 'archived'
        }
      })
    )
  }

  return {
    visible,
    query,
    setQuery,
    selectedId,
    setSelectedId,
    selected,
    possibleDuplicates,
    busy,
    message,
    importPreview,
    setImportPreview,
    edit,
    note,
    ban,
    merge,
    split,
    importRows,
    exportDirectory,
    setContactStatus,
    recordConsent,
    liftBan,
    toggleArchive
  }
}

export type CustomerDirectoryWorkspaceModel = ReturnType<
  typeof useCustomerDirectoryWorkspace
>
