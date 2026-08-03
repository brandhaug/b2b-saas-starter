import { describe, expect, it } from 'vitest'
import {
  makeWranglerOperatorMaintenanceDatabase,
  parseSystemOperatorCommand
} from './system-operator-maintenance.ts'

describe('System Operator maintenance command', () => {
  it('requires an explicit environment and exact target confirmation arguments', () => {
    expect(() =>
      parseSystemOperatorCommand([
        'recover',
        '--email',
        'operator@example.test',
        '--confirm-email',
        'operator@example.test',
        '--actor',
        'maintainer@example.test'
      ])
    ).toThrow('--environment must be exactly local or production')
  })

  it('preserves the explicit production and remote choices for capability policy', () => {
    expect(
      parseSystemOperatorCommand([
        'bootstrap',
        '--environment',
        'production',
        '--remote',
        '--email',
        'operator@example.test',
        '--confirm-email',
        'operator@example.test',
        '--actor',
        'maintainer@example.test',
        '--roles',
        'merchant-reader,operator-manager'
      ])
    ).toEqual({
      command: 'bootstrap',
      environment: 'production',
      remote: true,
      email: 'operator@example.test',
      confirmedEmail: 'operator@example.test',
      actor: 'maintainer@example.test',
      roles: ['merchant-reader', 'operator-manager']
    })
  })

  it('does not accept role changes through recovery', () => {
    expect(() =>
      parseSystemOperatorCommand([
        'recover',
        '--environment',
        'local',
        '--email',
        'operator@example.test',
        '--confirm-email',
        'operator@example.test',
        '--actor',
        'maintainer@example.test',
        '--roles',
        'operator-manager'
      ])
    ).toThrow('recovery does not accept --roles')
  })

  it('reads mutation counts explicitly because Wrangler omits them from metadata', async () => {
    let sql = ''
    const database = makeWranglerOperatorMaintenanceDatabase(false, async (input) => {
      sql = input.sql
      return [
        { results: [], meta: {} },
        { results: [{ changes: 1 }], meta: {} },
        { results: [], meta: {} },
        { results: [{ changes: 0 }], meta: {} }
      ]
    })

    await expect(
      database.batch([
        { sql: 'UPDATE user SET role = ?1 WHERE id = ?2', params: ['role', 'one'] },
        { sql: 'DELETE FROM session WHERE userId = ?1', params: ['one'] }
      ])
    ).resolves.toEqual([{ changes: 1 }, { changes: 0 }])
    expect(sql.match(/SELECT changes\(\) AS changes/g)).toHaveLength(2)
  })
})
