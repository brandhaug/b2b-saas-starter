import { env } from 'cloudflare:workers'
import { getRequest } from '@tanstack/react-start/server'
import { loadAllDocMetaHandler as loadMetadata } from '../../src/lib/docs.effects'

// Only the dedicated runtime build resolves this module. No production fault API.
export async function loadAllDocMetaHandler() {
  const gate = env.DOCS_METADATA_GATE
  if (gate !== undefined) {
    const response = await gate.fetch('https://metadata.test/load', {
      headers: { 'x-docs-request': getRequest().url }
    })
    if (!response.ok) {
      throw new Error('Controlled metadata loading failure')
    }
  }
  return loadMetadata()
}
