import { describe, expect, it } from 'vite-plus/test'

import {
  conversationLifecycleStatus,
  isCleanedConversation,
  isDeletedConversation,
  isLiveConversation,
  nextConversationLifecycleStatus,
  type ConversationDirectoryEntry
} from './directory.ts'

const fenced = '2026-09-15T10:00:00Z'
const cleaned = '2026-09-15T11:00:00Z'

function entry(
  fields: {
    readonly deletedAt?: string | null
    readonly cleanedAt?: string | null
  } = {}
): ConversationDirectoryEntry {
  return {
    id: 'c1',
    workspaceId: 'workspace',
    creatorUserId: 'owner',
    requiredPermissions: [],
    policyRevision: 0,
    runAccessRevision: 0,
    createdAt: fenced,
    deletedAt: null,
    cleanedAt: null,
    ...fields
  }
}

describe('conversationLifecycleStatus', () => {
  it('derives live from an untouched row', () => {
    expect(conversationLifecycleStatus(entry())).toBe('live')
  })

  it('derives deleted once the deletion fence has been written', () => {
    expect(conversationLifecycleStatus(entry({ deletedAt: fenced }))).toBe('deleted')
  })

  it('derives cleaned once cleanup has completed, with cleanedAt taking precedence', () => {
    expect(
      conversationLifecycleStatus(entry({ deletedAt: fenced, cleanedAt: cleaned }))
    ).toBe('cleaned')
  })
})

describe('nextConversationLifecycleStatus', () => {
  it('fences a live conversation and cleans a fenced one', () => {
    expect(nextConversationLifecycleStatus('live', { kind: 'fenced' })).toBe('deleted')
    expect(nextConversationLifecycleStatus('deleted', { kind: 'cleaned' })).toBe(
      'cleaned'
    )
  })

  it('refuses to clean a conversation that was never fenced', () => {
    expect(nextConversationLifecycleStatus('live', { kind: 'cleaned' })).toBeNull()
  })

  it('refuses to rewrite the fence on an already deleted row', () => {
    expect(nextConversationLifecycleStatus('deleted', { kind: 'fenced' })).toBeNull()
  })

  it('treats cleaned as terminal', () => {
    expect(nextConversationLifecycleStatus('cleaned', { kind: 'fenced' })).toBeNull()
    expect(nextConversationLifecycleStatus('cleaned', { kind: 'cleaned' })).toBeNull()
  })
})

describe('conversation lifecycle predicates', () => {
  it('agrees with the derived status for every state', () => {
    for (const row of [
      entry(),
      entry({ deletedAt: fenced }),
      entry({ deletedAt: fenced, cleanedAt: cleaned })
    ]) {
      const status = conversationLifecycleStatus(row)
      expect(isLiveConversation(row)).toBe(status === 'live')
      expect(isDeletedConversation(row)).toBe(status !== 'live')
      expect(isCleanedConversation(row)).toBe(status === 'cleaned')
    }
  })

  it('keeps cleaned tombstones deleted', () => {
    expect(
      isDeletedConversation(entry({ deletedAt: fenced, cleanedAt: cleaned }))
    ).toBe(true)
  })
})
