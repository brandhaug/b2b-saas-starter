import { useMemo, useState, type FormEvent } from 'react'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import {
  addCustomerNote,
  archiveCustomer,
  banCustomer,
  editCustomerPreferred,
  liftCustomerBan,
  recordCustomerConsent,
  searchCustomerRecords,
  setCustomerContactStatus
} from '@/lib/server/customer-directory.ts'
import { filterCustomerEntries } from './customer-contact-model.ts'
import { useCustomerDirectoryTransfer } from './use-customer-directory-transfer.ts'
import { useCustomerDirectoryReconciliation } from './use-customer-directory-reconciliation.ts'

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
  const [showArchived, setShowArchived] = useState(false)
  const visible = useMemo(
    () =>
      filterCustomerEntries(
        records.filter(
          (record) =>
            record.status === 'active' || (showArchived && record.status === 'archived')
        ),
        query
      ),
    [query, records, showArchived]
  )
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
  const reloadDirectory = async (includeArchived = showArchived) => {
    const authoritative = await searchCustomerRecords({
      data: { query: '', includeArchived }
    })
    setRecords(authoritative)
    setSelectedId((current) =>
      current && authoritative.some((record) => record.id === current)
        ? current
        : (authoritative[0]?.id ?? null)
    )
  }
  const { importPreview, setImportPreview, importRows, exportDirectory } =
    useCustomerDirectoryTransfer({
      records,
      reloadDirectory,
      setBusy,
      setMessage
    })
  const { merge, split } = useCustomerDirectoryReconciliation({
    records,
    selected,
    replace,
    reloadDirectory,
    setRecords,
    setSelectedId,
    setBusy,
    setMessage
  })
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
  const recordConsent = (destination: string, withdrawn: boolean) => {
    if (!selected) return
    void run(() =>
      recordCustomerConsent({
        data: {
          recordId: selected.id,
          expectedRevision: selected.revision,
          idempotencyKey: commandKey(),
          purpose: 'operational_mobile',
          destination,
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
    ).then((saved) => {
      if (saved) void reloadDirectory(showArchived)
    })
  }
  const toggleArchivedRecords = async () => {
    const next = !showArchived
    setBusy(true)
    setMessage(null)
    try {
      const authoritative = await searchCustomerRecords({
        data: { query: '', includeArchived: next }
      })
      setRecords(authoritative)
      setShowArchived(next)
      setSelectedId((current) =>
        current && authoritative.some((record) => record.id === current)
          ? current
          : (authoritative[0]?.id ?? null)
      )
    } catch {
      setMessage('Archived records could not be loaded. Try again.')
    } finally {
      setBusy(false)
    }
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
    showArchived,
    toggleArchivedRecords,
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
