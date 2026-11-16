import { describe, expect, it } from '@effect/vitest'
import { Redacted, Result } from 'effect'

import { outcomeToToolResult } from './mcp-results.ts'

describe('MCP tool result encoding', () => {
  it('keeps a Redacted value redacted unless its tool reveals it explicitly', () => {
    const result = outcomeToToolResult(
      Result.succeed({
        id: 'wh_1',
        nested: { secret: Redacted.make('must-stay-hidden') }
      })
    )
    expect(result.content).toMatchObject([
      { type: 'text', text: expect.stringContaining('<redacted>') }
    ])
    expect(result.content).toMatchObject([
      { text: expect.not.stringContaining('must-stay-hidden') }
    ])
  })
})
