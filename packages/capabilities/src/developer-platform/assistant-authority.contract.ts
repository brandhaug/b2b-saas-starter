import { DateTime, Effect } from 'effect'
import { type AssistantCredentialReference } from '@b2b-saas-starter/authz/assistant-access-token'
import { type ContractExpect } from '../governance/contract-expect.ts'
import {
  AssistantAuthority,
  type AssistantAuthorityState,
  type AssistantAuthorityInput
} from './assistant-authority.ts'

export const authorityResource = 'https://api.example/assistant'
function date(milliseconds: number) {
  return DateTime.toDate(DateTime.makeUnsafe(milliseconds))
}
export const authorityCredential = {
  kind: 'oauth',
  userId: 'usr_authority',
  workspaceId: 'wrk_authority',
  sessionId: 'ses_authority',
  expiresAt: 60_000,
  clientId: 'authority-client',
  consentBinding: 'consent_authority:0',
  resource: authorityResource,
  scopes: ['assistant:read', 'assistant:write']
} satisfies AssistantCredentialReference
const sessionProof = {
  expiresAt: date(60_000),
  impersonatedBy: null,
  passwordVerifiedAt: null,
  strongAuthAt: null,
  strongAuthMethod: null,
  strongAuthCredentialId: null,
  recoveryUntil: null
}
export const authorityState: AssistantAuthorityState = {
  context: {
    workspace: {
      id: 'wrk_authority',
      slug: 'authority',
      name: 'Authority',
      planId: 'free'
    },
    actor: { userId: 'usr_authority', role: 'member', systemRole: 'user' },
    actorType: 'user'
  },
  banned: false,
  suspended: false,
  currentSession: sessionProof,
  retainedSession: { ...sessionProof, revokedAt: null },
  totpId: null,
  passkeyIds: [],
  grant: {
    binding: 'consent_authority:0',
    scopes: ['assistant:read', 'assistant:write']
  }
}
const observe: AssistantAuthorityInput = {
  credential: authorityCredential,
  workspaceId: 'wrk_authority',
  creatorUserId: 'usr_authority',
  requiredPermissions: [],
  operation: 'read',
  mode: 'observe'
}
const expiredProof = { ...sessionProof, expiresAt: date(-1) }

export function assistantAuthorityContractCases(expect: ContractExpect) {
  const scenarios: ReadonlyArray<{
    readonly name: string
    readonly state: AssistantAuthorityState | null
    readonly input: AssistantAuthorityInput
    readonly allowed: boolean
  }> = [
    {
      name: 'refuses execution accepted in the future',
      state: authorityState,
      input: { ...observe, mode: 'run', acceptedAt: 1000, deadline: 2000 },
      allowed: false
    },
    {
      name: 'refuses execution at its deadline',
      state: authorityState,
      input: { ...observe, mode: 'run', acceptedAt: -1000, deadline: 0 },
      allowed: false
    },
    {
      name: 'refuses work accepted after its credential expired',
      state: authorityState,
      input: {
        ...observe,
        credential: { ...authorityCredential, expiresAt: -2000 },
        mode: 'run',
        acceptedAt: -1000,
        deadline: 1000
      },
      allowed: false
    },
    {
      name: 'refuses OAuth credentials for a different resource',
      state: authorityState,
      input: {
        ...observe,
        credential: {
          ...authorityCredential,
          resource: 'https://other.example/assistant'
        }
      },
      allowed: false
    },
    {
      name: 'refuses OAuth credentials for a different workspace',
      state: authorityState,
      input: {
        ...observe,
        credential: { ...authorityCredential, workspaceId: 'other-workspace' }
      },
      allowed: false
    },
    {
      name: 'withholds transcripts during an active account recovery window',
      state: {
        ...authorityState,
        currentSession: { ...sessionProof, recoveryUntil: date(1000) }
      },
      input: observe,
      allowed: false
    },
    {
      name: 'authorizes the current creator and workspace',
      state: authorityState,
      input: observe,
      allowed: true
    },
    {
      name: 'withholds another creator from a valid member',
      state: authorityState,
      input: { ...observe, creatorUserId: 'other' },
      allowed: false
    },
    {
      name: 'withholds unknown persisted transcript requirements',
      state: authorityState,
      input: { ...observe, requiredPermissions: ['unknown:read'] },
      allowed: false
    },
    {
      name: 'withholds restricted evidence from a member',
      state: authorityState,
      input: { ...observe, requiredPermissions: ['webhook:list'] },
      allowed: false
    },
    { name: 'refuses removed membership', state: null, input: observe, allowed: false },
    {
      name: 'refuses suspended workspaces',
      state: { ...authorityState, suspended: true },
      input: observe,
      allowed: false
    },
    {
      name: 'refuses a changed consent version',
      state: {
        ...authorityState,
        grant: {
          binding: 'consent_authority:1',
          scopes: ['assistant:read', 'assistant:write']
        }
      },
      input: observe,
      allowed: false
    },
    {
      name: 'refuses removed operation scope',
      state: {
        ...authorityState,
        grant: { binding: 'consent_authority:0', scopes: ['assistant:read'] }
      },
      input: { ...observe, operation: 'write' },
      allowed: false
    },
    {
      name: 'closes naturally expired observations',
      state: {
        ...authorityState,
        currentSession: expiredProof,
        retainedSession: { ...expiredProof, revokedAt: null }
      },
      input: { ...observe, credential: { ...authorityCredential, expiresAt: -1 } },
      allowed: false
    },
    {
      name: 'keeps valid OAuth observation after natural browser session expiry',
      state: {
        ...authorityState,
        currentSession: null,
        retainedSession: { ...expiredProof, revokedAt: null }
      },
      input: observe,
      allowed: true
    },
    {
      name: 'refuses browser observation after natural browser session expiry',
      state: {
        ...authorityState,
        currentSession: null,
        retainedSession: { ...expiredProof, revokedAt: null }
      },
      input: {
        ...observe,
        credential: {
          kind: 'session',
          userId: authorityCredential.userId,
          sessionId: authorityCredential.sessionId,
          expiresAt: authorityCredential.expiresAt
        }
      },
      allowed: false
    },
    {
      name: 'refuses valid OAuth observation after explicit expired-session revocation',
      state: {
        ...authorityState,
        currentSession: null,
        retainedSession: { ...expiredProof, revokedAt: date(-1) }
      },
      input: observe,
      allowed: false
    },
    {
      name: 'refuses OAuth observation with missing retained session proof',
      state: { ...authorityState, retainedSession: null },
      input: observe,
      allowed: false
    },
    {
      name: 'refuses OAuth observation when an unexpired browser session disappeared',
      state: { ...authorityState, currentSession: null },
      input: observe,
      allowed: false
    },
    {
      name: 'requires current privileged assurance after natural browser expiry',
      state: {
        ...authorityState,
        currentSession: null,
        retainedSession: { ...expiredProof, revokedAt: null },
        context: {
          ...authorityState.context,
          actor: { ...authorityState.context.actor, role: 'admin' }
        }
      },
      input: observe,
      allowed: false
    },
    {
      name: 'uses retained current privileged assurance for a valid OAuth credential',
      state: {
        ...authorityState,
        currentSession: null,
        retainedSession: {
          ...expiredProof,
          revokedAt: null,
          strongAuthAt: date(-1000),
          strongAuthMethod: 'totp',
          strongAuthCredentialId: 'totp_authority'
        },
        totpId: 'totp_authority',
        context: {
          ...authorityState.context,
          actor: { ...authorityState.context.actor, role: 'admin' }
        }
      },
      input: observe,
      allowed: true
    },
    {
      name: 'refuses stale retained privileged assurance for a valid OAuth credential',
      state: {
        ...authorityState,
        currentSession: null,
        retainedSession: {
          ...expiredProof,
          revokedAt: null,
          strongAuthAt: date(-8_640_000_000),
          strongAuthMethod: 'totp',
          strongAuthCredentialId: 'totp_authority'
        },
        totpId: 'totp_authority',
        context: {
          ...authorityState.context,
          actor: { ...authorityState.context.actor, role: 'admin' }
        }
      },
      input: observe,
      allowed: false
    },
    {
      name: 'refuses removed current factor despite retained privileged assurance',
      state: {
        ...authorityState,
        currentSession: null,
        retainedSession: {
          ...expiredProof,
          revokedAt: null,
          strongAuthAt: date(-1000),
          strongAuthMethod: 'totp',
          strongAuthCredentialId: 'totp_authority'
        },
        context: {
          ...authorityState.context,
          actor: { ...authorityState.context.actor, role: 'admin' }
        }
      },
      input: observe,
      allowed: false
    },
    {
      name: 'continues accepted work after natural credential and session expiry',
      state: {
        ...authorityState,
        currentSession: null,
        retainedSession: { ...expiredProof, revokedAt: null }
      },
      input: {
        ...observe,
        credential: { ...authorityCredential, expiresAt: -1 },
        mode: 'run',
        acceptedAt: -1000,
        deadline: 1000
      },
      allowed: true
    },
    {
      name: 'interrupts accepted work after explicit session revocation',
      state: {
        ...authorityState,
        currentSession: null,
        retainedSession: { ...expiredProof, revokedAt: date(-1) }
      },
      input: {
        ...observe,
        credential: { ...authorityCredential, expiresAt: -1 },
        mode: 'run',
        acceptedAt: -1000,
        deadline: 1000
      },
      allowed: false
    },
    {
      name: 'fails closed if retained revocation evidence is unavailable',
      state: { ...authorityState, retainedSession: null },
      input: { ...observe, mode: 'run', acceptedAt: -1000, deadline: 1000 },
      allowed: false
    },
    {
      name: 'rechecks strong assurance after promotion',
      state: {
        ...authorityState,
        context: {
          ...authorityState.context,
          actor: { ...authorityState.context.actor, role: 'admin' }
        }
      },
      input: observe,
      allowed: false
    }
  ]
  return scenarios.map((scenario) => ({
    name: scenario.name,
    state: scenario.state,
    input: scenario.input,
    allowed: scenario.allowed,
    assert: Effect.gen(function* () {
      const authority = yield* AssistantAuthority
      // The case literals are checked against the public contract below.
      const result = yield* Effect.result(authority.authorize(scenario.input))
      expect(result._tag === 'Success').toBe(scenario.allowed)
    })
  }))
}
