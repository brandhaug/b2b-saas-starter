import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import { mergeCustomers, splitCustomer } from '@/lib/server/customer-directory.ts'

const formValue = (data: FormData, field: string) => {
  const found = data.get(field)
  return typeof found === 'string' ? found.trim() : ''
}

const commandKey = () => crypto.randomUUID()

export function useCustomerDirectoryReconciliation({
  records,
  selected,
  replace,
  reloadDirectory,
  setRecords,
  setSelectedId,
  setBusy,
  setMessage
}: {
  readonly records: readonly CustomerRecord[]
  readonly selected: CustomerRecord | null
  readonly replace: (record: CustomerRecord) => void
  readonly reloadDirectory: (includeArchived?: boolean) => Promise<void>
  readonly setRecords: Dispatch<SetStateAction<readonly CustomerRecord[]>>
  readonly setSelectedId: Dispatch<SetStateAction<string | null>>
  readonly setBusy: Dispatch<SetStateAction<boolean>>
  readonly setMessage: Dispatch<SetStateAction<string | null>>
}) {
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

  return { merge, split }
}
