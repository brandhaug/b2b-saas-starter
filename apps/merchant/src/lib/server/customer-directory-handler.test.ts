import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  CustomerDirectory,
  SeedCustomerDirectory,
  emptySeedCustomerDirectoryStore
} from '@b2b-saas-starter/capabilities/customer-directory'
import { testMerchantContext } from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  makeCustomerDirectoryRequestHandler,
  type CustomerDirectoryRunner
} from './customer-directory-handler.ts'

const merchant = {
  id: 'mer_customer_directory',
  publicName: 'Solo Studio',
  slug: 'solo-studio',
  timezone: 'Europe/Bucharest',
  currency: 'EUR',
  plan: 'solo' as const
}

describe('Merchant Customer Directory request boundary', () => {
  it('returns stable Merchant-scoped Customer Records instead of Appointment rows', async () => {
    const store = emptySeedCustomerDirectoryStore()
    const layer = Layer.merge(
      SeedCustomerDirectory(store),
      testMerchantContext(merchant)
    )
    const run: CustomerDirectoryRunner = (_userId, effect) =>
      Effect.runPromise(Effect.provide(effect, layer))
    const requests = makeCustomerDirectoryRequestHandler({
      currentUserId: async () => 'usr_owner',
      run,
      now: () => '2026-08-03T10:00:00.000Z'
    })

    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(CustomerDirectory, (directory) =>
          directory.matchOrCreate({
            appointmentId: 'apt_first',
            details: {
              name: 'Ana Popescu',
              email: 'ana@example.com',
              phone: '+40700000000'
            },
            now: '2026-08-03T09:00:00.000Z'
          })
        ),
        layer
      )
    )
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(CustomerDirectory, (directory) =>
          directory.matchOrCreate({
            appointmentId: 'apt_second',
            details: {
              name: 'Ana Popescu',
              email: 'ana@example.com',
              phone: '+40700000000'
            },
            now: '2026-08-03T09:30:00.000Z'
          })
        ),
        layer
      )
    )

    const records = await requests.search('ana@example.com')

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: expect.any(String),
      displayName: 'Ana Popescu',
      preferredEmail: 'ana@example.com',
      status: 'active'
    })
    expect(records[0]?.id).not.toBe('apt_first')
    expect(
      records[0]?.observations.map((observation) => observation.appointmentId)
    ).toEqual(['apt_first', 'apt_second'])
  })

  it('persists revisioned Owner edits, private notes, and bans', async () => {
    const store = emptySeedCustomerDirectoryStore()
    const layer = Layer.merge(
      SeedCustomerDirectory(store),
      testMerchantContext(merchant)
    )
    const run: CustomerDirectoryRunner = (_userId, effect) =>
      Effect.runPromise(Effect.provide(effect, layer))
    const requests = makeCustomerDirectoryRequestHandler({
      currentUserId: async () => 'usr_owner',
      run,
      now: () => '2026-08-03T10:00:00.000Z'
    })
    const created = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(CustomerDirectory, (directory) =>
          directory.matchOrCreate({
            appointmentId: 'apt_customer',
            details: {
              name: 'Ana Popescu',
              email: 'ana@example.com',
              phone: null
            },
            now: '2026-08-03T09:00:00.000Z'
          })
        ),
        layer
      )
    )

    const edited = await requests.editPreferred(created.record.id, {
      expectedRevision: created.record.revision,
      idempotencyKey: 'cmd_edit_customer',
      name: 'Ana Ionescu',
      email: 'ana@example.com',
      phone: '+40700000001'
    })
    const noted = await requests.addNote(created.record.id, {
      expectedRevision: edited.revision,
      idempotencyKey: 'cmd_note_customer',
      text: 'Prefers quiet appointments.'
    })
    const banned = await requests.setBan(created.record.id, {
      expectedRevision: noted.revision,
      idempotencyKey: 'cmd_ban_customer',
      reason: 'Repeated abusive conduct',
      expiresAt: null
    })

    expect(banned).toMatchObject({
      displayName: 'Ana Ionescu',
      preferredPhone: '+40700000001',
      notes: [
        expect.objectContaining({
          text: 'Prefers quiet appointments.',
          actorId: 'usr_owner'
        })
      ],
      ban: expect.objectContaining({
        reason: 'Repeated abusive conduct',
        actorId: 'usr_owner'
      })
    })
  })
})
