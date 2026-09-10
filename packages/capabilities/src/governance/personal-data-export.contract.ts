import { Effect, Result, Schema } from 'effect'
import * as TestClock from 'effect/testing/TestClock'

import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type ContractExpect } from './contract-expect.ts'
import { PersonalDataExports } from './personal-data-export.ts'
import { PersonalDataExport } from './personal-data-export-archive.ts'

/**
 * The personal-archive contract, written once and run against both adapters
 * — capabilities invariant 4.
 *
 * The archive is the account's own copy of everything held about it, so what
 * both adapters owe is the same *shape*: every section present, every row in
 * it the requester's, and nothing in it that is not theirs to have. Where the
 * rows come from is the adapter's business (five D1 joins on Live, fixture
 * rows on Seed), so the harness states what it planted and the cases assert
 * the archive reports exactly that.
 */

// Synchronous on purpose: a malformed archive is a failed assertion in the
// case that produced it, not a typed failure the contract's error channel
// should carry into every caller.
const decodeArchive = Schema.decodeUnknownSync(
  Schema.fromJsonString(PersonalDataExport)
)

/** What one harness planted for the account the cases export. */
export type PersonalDataExportSubject = {
  readonly userId: string
  readonly sessionId: string
  /** A second live session of the same user: a download must refuse it. */
  readonly otherSessionId: string
  /** Another account with its own live session, whose download must refuse too. */
  readonly otherUser: { readonly userId: string; readonly sessionId: string }
  /** A user id no adapter has an account for. */
  readonly unknownUserId: string
  /** The ids the requester's archive must report, section by section. */
  readonly expected: {
    readonly workspaceIds: ReadonlyArray<string>
    readonly notifications: ReadonlyArray<{
      readonly id: string
      readonly workspaceId: string
    }>
    readonly sessionIds: ReadonlyArray<string>
    readonly linkedAccountIds: ReadonlyArray<string>
    readonly oauthClientIds: ReadonlyArray<string>
    readonly oauthConsentIds: ReadonlyArray<string>
    readonly passkeyIds: ReadonlyArray<string>
  }
  /** Material the archive must never carry: credentials, and other people's rows. */
  readonly secrets: ReadonlyArray<string>
}

export type PersonalDataExportContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<void, CapabilityUnavailable, PersonalDataExports>
}

export function personalDataExportContractCases(
  subject: PersonalDataExportSubject,
  expect: ContractExpect
): ReadonlyArray<PersonalDataExportContractCase> {
  /** Request and download in one breath — every case below starts this way. */
  const archive = Effect.gen(function* () {
    const exports = yield* PersonalDataExports
    const receipt = yield* exports.request(subject.userId, subject.sessionId)
    const download = yield* exports.download(
      subject.userId,
      subject.sessionId,
      receipt.id
    )
    return { receipt, download }
  })

  return [
    {
      // Every section, not just the ones a given adapter finds easy: an
      // adapter that hardcoded `sessions: []` would still produce a valid
      // archive, and the account would silently never learn what it holds.
      name: 'reports every personal section with the requester’s own rows',
      assert: Effect.gen(function* () {
        const { download } = yield* archive
        const data = decodeArchive(download.json)

        expect(data.user.id).toBe(subject.userId)
        expect(data.workspaces.map((row) => row.workspace.id).toSorted()).toEqual(
          [...subject.expected.workspaceIds].toSorted()
        )
        expect(data.sessions.map((row) => row.id).toSorted()).toEqual(
          [...subject.expected.sessionIds].toSorted()
        )
        expect(data.linkedAccounts.map((row) => row.id).toSorted()).toEqual(
          [...subject.expected.linkedAccountIds].toSorted()
        )
        expect(data.oauthClients.map((row) => row.clientId).toSorted()).toEqual(
          [...subject.expected.oauthClientIds].toSorted()
        )
        expect(data.oauthConsents.map((row) => row.id).toSorted()).toEqual(
          [...subject.expected.oauthConsentIds].toSorted()
        )
        expect(data.passkeys.map((row) => row.id).toSorted()).toEqual(
          [...subject.expected.passkeyIds].toSorted()
        )
      })
    },
    {
      // Each notification names the workspace it was raised in. Stamping one
      // workspace across the archive would misreport a cross-workspace
      // notification as belonging to whichever workspace the fixture calls
      // its own.
      name: 'names each notification’s own workspace',
      assert: Effect.gen(function* () {
        const { download } = yield* archive
        const data = decodeArchive(download.json)
        expect(
          data.notifications
            .map((row) => `${row.id}@${row.workspaceId ?? 'none'}`)
            .toSorted()
        ).toEqual(
          subject.expected.notifications
            .map((row) => `${row.id}@${row.workspaceId}`)
            .toSorted()
        )
      })
    },
    {
      name: 'carries no credential material and no other account’s rows',
      assert: Effect.gen(function* () {
        const { download } = yield* archive
        const leaked: Array<string> = []
        for (const secret of subject.secrets) {
          // oxlint-disable-next-line react-doctor/js-set-map-lookups -- substring search over the archive text, not array membership; a Set cannot answer it
          if (download.json.includes(secret)) {
            leaked.push(secret)
          }
        }
        expect(leaked).toEqual([])
      })
    },
    {
      name: 'refuses an export for an account it does not know',
      assert: Effect.gen(function* () {
        const exports = yield* PersonalDataExports
        expect(
          Result.isFailure(
            yield* Effect.result(
              exports.request(subject.unknownUserId, subject.sessionId)
            )
          )
        ).toBe(true)
      })
    },
    {
      // The artifact is bound to the exact (user, session) that asked for it:
      // a second session of the same account is as much a stranger to it as
      // another account is.
      name: 'binds the archive to the user and session that requested it',
      assert: Effect.gen(function* () {
        const exports = yield* PersonalDataExports
        const { receipt } = yield* archive
        expect(
          Result.isFailure(
            yield* Effect.result(
              exports.download(subject.userId, subject.otherSessionId, receipt.id)
            )
          )
        ).toBe(true)
        expect(
          Result.isFailure(
            yield* Effect.result(
              exports.download(
                subject.otherUser.userId,
                subject.otherUser.sessionId,
                receipt.id
              )
            )
          )
        ).toBe(true)
      })
    },
    {
      name: 'expires the archive, and a later request mints a fresh one',
      assert: Effect.gen(function* () {
        const exports = yield* PersonalDataExports
        const { receipt } = yield* archive
        yield* TestClock.adjust('24 hours')
        expect(
          Result.isFailure(
            yield* Effect.result(
              exports.download(subject.userId, subject.sessionId, receipt.id)
            )
          )
        ).toBe(true)
        const replacement = yield* exports.request(subject.userId, subject.sessionId)
        expect(replacement.id === receipt.id).toBe(false)
        expect(
          (yield* exports.download(subject.userId, subject.sessionId, replacement.id))
            .fileName
        ).toBe(`personal-data-${subject.userId}.json`)
      })
    }
  ]
}
