import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fixtureSession } from '@/test/fixture-session'
import {
  downloadPersonalDataHandler,
  exportPersonalDataHandler
} from './account.effects'
import type * as AuthModule from './auth'

type ExportActor = { signedIn: boolean; impersonatedBy: string | null }

const actor = vi.hoisted((): ExportActor => ({
  signedIn: true,
  impersonatedBy: null
}))

vi.mock('./auth', async (importOriginal) => {
  const original = await importOriginal<typeof AuthModule>()
  return {
    ...original,
    requireRequestSession: async () => {
      if (!actor.signedIn) {
        throw new original.UnauthorizedError()
      }
      return fixtureSession({
        userId: 'usr_demo',
        impersonatedBy: actor.impersonatedBy
      })
    }
  }
})

beforeEach(() => {
  actor.signedIn = true
  actor.impersonatedBy = null
})

describe('personal export authentication', () => {
  it('requires a signed-in session for preparation and download', async () => {
    actor.signedIn = false
    await expect(exportPersonalDataHandler()).rejects.toMatchObject({
      code: 'unauthorized'
    })
    await expect(
      downloadPersonalDataHandler({ exportId: 'private-export' })
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('requires recent authentication again for a direct download', async () => {
    await expect(exportPersonalDataHandler()).rejects.toMatchObject({
      code: 'strong_authentication_required'
    })
    await expect(
      downloadPersonalDataHandler({ exportId: 'private-export' })
    ).rejects.toMatchObject({ code: 'strong_authentication_required' })
  })

  it('does not let an impersonating operator prepare or download personal data', async () => {
    actor.impersonatedBy = 'usr_operator'
    await expect(exportPersonalDataHandler()).rejects.toMatchObject({
      code: 'strong_authentication_required'
    })
    await expect(
      downloadPersonalDataHandler({ exportId: 'private-export' })
    ).rejects.toMatchObject({ code: 'strong_authentication_required' })
  })
})
