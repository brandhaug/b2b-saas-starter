import { Effect } from 'effect'
import {
  CustomerDirectory,
  type CustomerDirectoryError,
  type CustomerDirectoryShape,
  type DirectoryCustomerDetails
} from '@b2b-saas-starter/capabilities/customer-directory'
import type { MerchantContext } from '@b2b-saas-starter/capabilities/merchant-catalog'

type Services = CustomerDirectory | MerchantContext

export type CustomerDirectoryRunner = <A>(
  userId: string,
  effect: Effect.Effect<A, CustomerDirectoryError, Services>
) => Promise<A>

export const makeCustomerDirectoryRequestHandler = (dependencies: {
  readonly currentUserId: () => Promise<string>
  readonly run: CustomerDirectoryRunner
  readonly now: () => string
}) => {
  const execute = <A>(
    use: (
      directory: CustomerDirectoryShape,
      actorId: string,
      now: string
    ) => Effect.Effect<A, CustomerDirectoryError, MerchantContext>
  ) =>
    dependencies.currentUserId().then((userId) =>
      dependencies.run(
        userId,
        Effect.flatMap(CustomerDirectory, (directory) =>
          use(directory, userId, dependencies.now())
        )
      )
    )

  return {
    search: (query: string) => execute((directory) => directory.search(query)),
    get: (recordId: string) => execute((directory) => directory.get(recordId)),
    editPreferred: (
      recordId: string,
      input: {
        readonly expectedRevision: number
        readonly idempotencyKey: string
      } & DirectoryCustomerDetails
    ) =>
      execute((directory, actorId, now) =>
        directory.editPreferred(recordId, { ...input, actorId, now })
      ),
    addNote: (
      recordId: string,
      input: {
        readonly expectedRevision: number
        readonly idempotencyKey: string
        readonly text: string
      }
    ) =>
      execute((directory, actorId, now) =>
        directory.addNote(recordId, { ...input, actorId, now })
      ),
    setContactStatus: (
      recordId: string,
      input: {
        readonly expectedRevision: number
        readonly idempotencyKey: string
        readonly kind: 'email' | 'phone'
        readonly value: string
        readonly status: 'active' | 'disputed' | 'superseded'
        readonly preferred: boolean
      }
    ) =>
      execute((directory, actorId, now) =>
        directory.setContactStatus(recordId, { ...input, actorId, now })
      ),
    recordConsent: (
      recordId: string,
      input: {
        readonly expectedRevision: number
        readonly idempotencyKey: string
        readonly purpose: 'operational_mobile' | 'marketing'
        readonly destination: string
        readonly wordingVersion: string
        readonly source: string
        readonly withdrawn: boolean
      }
    ) =>
      execute((directory, actorId, now) =>
        directory.recordConsent(recordId, { ...input, actorId, now })
      ),
    setBan: (
      recordId: string,
      input: {
        readonly expectedRevision: number
        readonly idempotencyKey: string
        readonly reason: string
        readonly expiresAt: string | null
      }
    ) =>
      execute((directory, actorId, now) =>
        directory.setBan(recordId, { ...input, actorId, now })
      ),
    liftBan: (
      recordId: string,
      input: {
        readonly expectedRevision: number
        readonly idempotencyKey: string
        readonly reason: string
      }
    ) =>
      execute((directory, actorId, now) =>
        directory.liftBan(recordId, { ...input, actorId, now })
      ),
    merge: (input: {
      readonly survivorId: string
      readonly absorbedId: string
      readonly expectedSurvivorRevision: number
      readonly expectedAbsorbedRevision: number
      readonly idempotencyKey: string
      readonly preferredDetailsSourceId?: string
      readonly reason: string
    }) =>
      execute((directory, actorId, now) => directory.merge({ ...input, actorId, now })),
    split: (input: {
      readonly sourceId: string
      readonly observationIds: readonly string[]
      readonly expectedRevision: number
      readonly idempotencyKey: string
      readonly createdDetails?: DirectoryCustomerDetails
      readonly contactKeys?: readonly {
        readonly kind: 'email' | 'phone'
        readonly value: string
      }[]
      readonly noteIds?: readonly string[]
      readonly consentIds?: readonly string[]
      readonly reason: string
    }) =>
      execute((directory, actorId, now) => directory.split({ ...input, actorId, now })),
    archive: (
      recordId: string,
      input: {
        readonly expectedRevision: number
        readonly idempotencyKey: string
        readonly archived: boolean
      }
    ) =>
      execute((directory, actorId, now) =>
        directory.archive(recordId, { ...input, actorId, now })
      ),
    previewImport: (rows: readonly DirectoryCustomerDetails[]) =>
      execute((directory) => directory.previewImport(rows)),
    importRows: (input: {
      readonly fileId: string
      readonly idempotencyKey: string
      readonly expectedRevisions: Readonly<Record<string, number>>
      readonly rows: readonly (DirectoryCustomerDetails & {
        readonly externalReference?: string
      })[]
    }) =>
      execute((directory, actorId, now) =>
        directory.importRows({ ...input, actorId, now })
      ),
    exportMinimized: () => execute((directory) => directory.exportMinimized())
  }
}
