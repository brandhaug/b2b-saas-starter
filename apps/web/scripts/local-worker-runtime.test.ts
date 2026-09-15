// @vitest-environment node
/* oxlint-disable effect/noNodeBuiltinImport -- This test owns native runtime startup and teardown outside an application Effect runtime. */
import { workerCompatibility } from '../../../infra/bindings.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { describe, expect, it } from 'vite-plus/test'
import { localConversationNamespace } from './local-worker-runtime.mjs'

describe('local native namespace', () => {
  it('forwards a Node Request and preserves SQLite state through runtime restart', async () => {
    const path = await mkdtemp(join(tmpdir(), 'starter-local-namespace-'))
    const options = convertV4MiniflareOptions({
      name: 'local-namespace-test',
      modules: true,
      script: `import { DurableObject } from 'cloudflare:workers';
        export class Store extends DurableObject {
          async fetch(request) {
            this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS saved (value TEXT)');
            if (request.method === 'POST') {
              this.ctx.storage.sql.exec('INSERT INTO saved VALUES (?)', request.headers.get('x-test') + ':' + await request.text());
            }
            return Response.json(this.ctx.storage.sql.exec('SELECT value FROM saved').toArray());
          }
        }
        export default {fetch() {return new Response('Not found', {status:404})}}`,
      compatibilityDate: workerCompatibility.date,
      cf: false,
      durableObjects: { STORE: { className: 'Store', useSQLite: true } },
      resourcePersistencePath: path,
      isolatedResourcePersistencePath: path
    })
    let active = new Miniflare(options)
    try {
      const namespace = localConversationNamespace(
        await active.getDurableObjectNamespace('STORE')
      )
      const response = await namespace.getByName('saved').fetch(
        new Request('https://local.test/write', {
          method: 'POST',
          headers: { 'x-test': 'preserved' },
          body: 'question'
        })
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([{ value: 'preserved:question' }])
      await active.dispose()
      active = new Miniflare(options)
      const restored = localConversationNamespace(
        await active.getDurableObjectNamespace('STORE')
      )
      const history = await restored
        .getByName('saved')
        .fetch(new Request('https://local.test/read'))
      expect(await history.json()).toEqual([{ value: 'preserved:question' }])
    } finally {
      await active.dispose()
      await rm(path, { recursive: true, force: true })
    }
  })
})
