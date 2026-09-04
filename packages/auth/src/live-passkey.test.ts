import { createDrizzleDb, type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { passkey as passkeyTable, user } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON
} from '@better-auth/passkey/client'
import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { type Service } from 'effectful-better-auth'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { Auth, AuthConfig, type AuthEmailSender, type AuthOptions } from './index.ts'
import { decodeUriSecret } from './test-totp.ts'

/* oxlint-disable effect/noGlobals, effect/noAsyncFunction -- these tests run a
   mocked WebAuthn ceremony over real WebCrypto: the whole point is that ES256
   key generation, SHA-256 digests, and DER signatures behave as the plugin's
   verifier (@simplewebauthn/server) expects. Faking the crypto would prove
   nothing about the wiring under test (same stance as billing.test.ts). */

// The passkey plugin is only observable through a real database AND a real
// ceremony: its endpoints verify WebAuthn assertions cryptographically before
// they touch D1, so asserting on the options object alone would pass even if
// every table lookup failed. This suite drives `Auth.instance.api` against a
// local D1 (workerd, every committed migration applied) with a software
// authenticator that speaks just enough WebAuthn: one ES256 credential,
// `none`-format attestation, and assertions signed over the real challenge
// bytes. The two-factor case at the bottom is the mechanical proof of ADR
// 0056's central claim: a passkey sign-in opens a session even while TOTP is
// enabled, because the plugin creates the session directly instead of going
// through the credential-sign-in path the two-factor hook intercepts.

type AuthService = Service<AuthOptions>

const BASE_URL = 'http://localhost:3071'
const RP_ID = 'localhost'

let testD1: TestD1
let db: DrizzleDatabase
let authLayer: Layer.Layer<AuthService>

const capturingEmailSender: AuthEmailSender = {
  sendResetPassword: () => Promise.resolve(),
  sendVerificationEmail: () => Promise.resolve()
}

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        testD1 = yield* Effect.promise(() => provisionTestD1())
        db = createDrizzleDb(testD1.d1)
        authLayer = Auth.layer.pipe(
          Layer.provide(
            Layer.sync(AuthConfig)(() => ({
              db,
              secret: 'test-secret-at-least-32-characters-long',
              baseURL: BASE_URL,
              trustedOrigins: [],
              emails: capturingEmailSender,
              requireEmailVerification: false,
              runBackground: (promise) => {
                void promise.catch(() => undefined)
              }
            }))
          )
        )
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => testD1.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.runPromise(Effect.provide(effect, authLayer))
}

/* -------------------------------------------------------------------------- */
/* A software authenticator                                                    */
/* -------------------------------------------------------------------------- */

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * Wraps a raw P1363 `r||s` signature in the ASN.1 DER envelope WebAuthn
 * specifies. Node's WebCrypto hands back the raw form (64 bytes for P-256)
 * while real authenticators emit DER, and the plugin's verifier unwraps DER —
 * so the software authenticator has to do the wrapping itself.
 */
function derSignature(raw: Uint8Array): Uint8Array {
  function derInteger(bytes: Uint8Array): Uint8Array {
    let value = bytes
    if ((bytes[0] ?? 0) >= 0x80) {
      value = Uint8Array.from([0x00, ...bytes])
    }
    return Uint8Array.from([0x02, value.length, ...value])
  }
  const r = derInteger(raw.slice(0, 32))
  const s = derInteger(raw.slice(32, 64))
  const body = Uint8Array.from([...r, ...s])
  return Uint8Array.from([0x30, body.length, ...body])
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(digest)
}

function u16be(value: number): Uint8Array {
  return Uint8Array.from([(value >> 8) & 0xff, value & 0xff])
}

function u32be(value: number): Uint8Array {
  return Uint8Array.from([
    (value >> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff
  ])
}

/**
 * Minimal CBOR encoder for exactly the value shapes WebAuthn needs: small
 * (u)ints, negative ints, byte strings, text strings, and maps, all under the
 * 24-item/24-byte inline-length thresholds. It exists only to build the COSE
 * public key and the `none`-format attestation object — @simplewebauthn's
 * decoder is the arbiter of whether the output is real CBOR.
 */
type CborValue =
  | { readonly tag: 'int'; readonly value: number }
  | { readonly tag: 'text'; readonly value: string }
  | { readonly tag: 'bytes'; readonly value: Uint8Array }
  | {
      readonly tag: 'map'
      readonly entries: ReadonlyArray<readonly [CborValue, CborValue]>
    }

function cborHead(major: number, length: number, out: Array<number>): void {
  const type = major << 5
  if (length < 24) {
    out.push(type | length)
    return
  }
  if (length < 256) {
    out.push(type | 24, length)
    return
  }
  throw new Error('cbor: length outside the range this encoder supports')
}

function cbor(value: CborValue, out: Array<number>): void {
  if (value.tag === 'int') {
    if (value.value >= 0) {
      cborHead(0, value.value, out)
    } else {
      cborHead(1, -value.value - 1, out)
    }
    return
  }
  if (value.tag === 'text') {
    const bytes = [...new TextEncoder().encode(value.value)]
    cborHead(3, bytes.length, out)
    out.push(...bytes)
    return
  }
  if (value.tag === 'bytes') {
    cborHead(2, value.value.length, out)
    out.push(...value.value)
    return
  }
  cborHead(5, value.entries.length, out)
  for (const [key, entry] of value.entries) {
    cbor(key, out)
    cbor(entry, out)
  }
}

function cborBytes(value: CborValue): Uint8Array {
  const out: Array<number> = []
  cbor(value, out)
  return Uint8Array.from(out)
}

function CBOR_INT(value: number): CborValue {
  return { tag: 'int', value }
}

function CBOR_TEXT(value: string): CborValue {
  return { tag: 'text', value }
}

function CBOR_BYTES(value: Uint8Array): CborValue {
  return { tag: 'bytes', value }
}

function CBOR_MAP(entries: ReadonlyArray<readonly [CborValue, CborValue]>): CborValue {
  return { tag: 'map', entries }
}

/** Registration flags: UP | UV | BE | BS | AT — a synced, backed-up key. */
const REGISTRATION_FLAGS = 0x01 | 0x04 | 0x08 | 0x10 | 0x40
/** Assertion flags: UP | UV | BE | BS. */
const ASSERTION_FLAGS = 0x01 | 0x04 | 0x08 | 0x10

type SoftwareCredential = {
  readonly id: Uint8Array
  readonly userHandle: string
  readonly privateKey: CryptoKey
  counter: number
}

/**
 * Runs one full registration ceremony, returning the passkey row it wrote.
 * The options shape is the plugin's own response type narrowed to the two
 * fields the ceremony reads.
 */
type RegistrationOptions = Pick<PublicKeyCredentialCreationOptionsJSON, 'challenge'> & {
  readonly user: { readonly id: string }
}
type AuthenticationOptions = Pick<PublicKeyCredentialRequestOptionsJSON, 'challenge'>

/**
 * One software authenticator holding one or more ES256 credentials. Each
 * method performs the client half of one ceremony against the challenge the
 * plugin just issued: registration mints a key and attests it (`fmt: none`,
 * the format that carries no attestation statement), authentication signs the
 * assertion over the authenticator data and the client data hash.
 */
function makeAuthenticator() {
  const credentials: Array<SoftwareCredential> = []

  async function generateKey(): Promise<{ key: CryptoKey; cose: Uint8Array }> {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    )
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const x = raw.slice(1, 33)
    const y = raw.slice(33, 65)
    const cose = cborBytes(
      CBOR_MAP([
        [CBOR_INT(1), CBOR_INT(2)], // kty: EC2
        [CBOR_INT(3), CBOR_INT(-7)], // alg: ES256
        [CBOR_INT(-1), CBOR_INT(1)], // crv: P-256
        [CBOR_INT(-2), CBOR_BYTES(x)],
        [CBOR_INT(-3), CBOR_BYTES(y)]
      ])
    )
    return { key: pair.privateKey, cose }
  }

  async function register(
    options: RegistrationOptions
  ): Promise<RegistrationResponseJSON> {
    const credentialId = crypto.getRandomValues(new Uint8Array(32))
    const { key, cose } = await generateKey()
    const rpIdHash = await sha256(new TextEncoder().encode(RP_ID))
    const authData = Uint8Array.from([
      ...rpIdHash,
      REGISTRATION_FLAGS,
      ...u32be(0),
      ...new Uint8Array(16), // zero AAGUID (attestation: none)
      ...u16be(credentialId.length),
      ...credentialId,
      ...cose
    ])
    const attestationObject = cborBytes(
      CBOR_MAP([
        [CBOR_TEXT('fmt'), CBOR_TEXT('none')],
        [CBOR_TEXT('attStmt'), CBOR_MAP([])],
        [CBOR_TEXT('authData'), CBOR_BYTES(authData)]
      ])
    )
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge: options.challenge,
      origin: BASE_URL,
      crossOrigin: false
    })
    credentials.push({
      id: credentialId,
      userHandle: options.user.id,
      privateKey: key,
      counter: 0
    })
    return {
      id: toBase64Url(credentialId),
      rawId: toBase64Url(credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: toBase64Url(new TextEncoder().encode(clientDataJSON)),
        attestationObject: toBase64Url(attestationObject),
        transports: ['internal', 'hybrid']
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform'
    }
  }

  async function authenticate(
    options: AuthenticationOptions
  ): Promise<AuthenticationResponseJSON> {
    const credential = credentials[0]
    if (credential === undefined) {
      throw new Error('software authenticator has no credential')
    }
    credential.counter += 1
    const rpIdHash = await sha256(new TextEncoder().encode(RP_ID))
    const authData = Uint8Array.from([
      ...rpIdHash,
      ASSERTION_FLAGS,
      ...u32be(credential.counter)
    ])
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.get',
      challenge: options.challenge,
      origin: BASE_URL,
      crossOrigin: false
    })
    // The assertion signs the authenticator data RAW, concatenated with the
    // client data hash — not a double hash.
    const signed = Uint8Array.from([
      ...authData,
      ...(await sha256(new TextEncoder().encode(clientDataJSON)))
    ])
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        credential.privateKey,
        signed
      )
    )
    return {
      id: toBase64Url(credential.id),
      rawId: toBase64Url(credential.id),
      type: 'public-key',
      response: {
        clientDataJSON: toBase64Url(new TextEncoder().encode(clientDataJSON)),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(derSignature(signature)),
        userHandle: credential.userHandle
      },
      clientExtensionResults: {}
    }
  }

  return { register, authenticate }
}

/* -------------------------------------------------------------------------- */
/* Session + cookie plumbing                                                  */
/* -------------------------------------------------------------------------- */

function signUpSession(email: string) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    const { headers } = yield* Effect.promise(() =>
      auth.instance.api.signUpEmail({
        body: { email, name: email, password: 'correct-horse-battery-staple' },
        returnHeaders: true
      })
    )
    const cookieHeader = headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ')
    if (cookieHeader.length === 0) {
      return yield* Effect.die(`sign-up set no cookie for ${email}`)
    }
    return { cookieHeader }
  })
}

/** Reads every `Set-Cookie` off a response as `name=value` pairs. */
function responseCookies(headers: Headers): string {
  return headers.getSetCookie().join('; ')
}

/** Merges two cookie strings, later pairs winning on name collisions. */
function mergeCookies(left: string, right: string): string {
  const merged = new Map(
    [...left.split('; '), ...right.split('; ')]
      .filter((pair) => pair.length > 0)
      .map((pair) => [pair.split('=')[0]!, pair])
  )
  return [...merged.values()].join('; ')
}

/** Runs one full registration ceremony, returning the passkey row it wrote. */
async function registerPasskey(
  cookieHeader: string,
  authenticator: ReturnType<typeof makeAuthenticator>,
  name: string
) {
  const auth = await Effect.runPromise(Effect.provide(Auth.Tag, authLayer))
  const optionsResponse = await auth.instance.api.generatePasskeyRegistrationOptions({
    headers: new Headers({ cookie: cookieHeader }),
    returnHeaders: true
  })
  const challengeCookie = responseCookies(optionsResponse.headers)
  const registrationResponse = await authenticator.register(optionsResponse.response)
  return auth.instance.api.verifyPasskeyRegistration({
    body: { response: registrationResponse, name },
    headers: new Headers({ cookie: mergeCookies(cookieHeader, challengeCookie) })
  })
}

/** Runs one full sign-in ceremony, returning the verify response and its cookies. */
async function signInWithPasskey(authenticator: ReturnType<typeof makeAuthenticator>) {
  const auth = await Effect.runPromise(Effect.provide(Auth.Tag, authLayer))
  const optionsResponse = await auth.instance.api.generatePasskeyAuthenticationOptions({
    returnHeaders: true
  })
  const challengeCookie = responseCookies(optionsResponse.headers)
  const assertionResponse = await authenticator.authenticate(optionsResponse.response)
  const verification = await auth.instance.api.verifyPasskeyAuthentication({
    body: { response: assertionResponse },
    headers: new Headers({ cookie: challengeCookie }),
    returnHeaders: true
  })
  return { verification, cookies: responseCookies(verification.headers) }
}

/* -------------------------------------------------------------------------- */
/* The suites                                                                 */
/* -------------------------------------------------------------------------- */

describe('passkey plugin', () => {
  it('registers a passkey under a user-chosen name against the mapped table', () =>
    run(
      Effect.gen(function* () {
        const { cookieHeader } = yield* signUpSession('passkey@owner.test')
        const authenticator = makeAuthenticator()

        const created = yield* Effect.promise(() =>
          registerPasskey(cookieHeader, authenticator, 'MacBook Touch ID')
        )
        expect(created.name).toBe('MacBook Touch ID')
        expect(created.deviceType).toBe('multiDevice')
        expect(created.backedUp).toBe(true)

        const rows = yield* Effect.promise(() => db.select().from(passkeyTable))
        expect(rows).toHaveLength(1)
        expect(rows[0]?.name).toBe('MacBook Touch ID')
        expect(rows[0]?.credentialID).toBe(created.credentialID)
      })
    ))

  it('lists, renames, and removes the signed-in user passkeys', () =>
    run(
      Effect.gen(function* () {
        const { cookieHeader } = yield* signUpSession('passkey@manage.test')
        const authenticator = makeAuthenticator()
        const created = yield* Effect.promise(() =>
          registerPasskey(cookieHeader, authenticator, 'Phone')
        )
        const headers = new Headers({ cookie: cookieHeader })
        const auth = yield* Auth.Tag

        const listed = yield* auth.api.listPasskeys({ headers })
        expect(listed.map((entry) => entry.id)).toContain(created.id)

        const renamed = yield* auth.api.updatePasskey({
          body: { id: created.id, name: 'Tablet' },
          headers
        })
        expect(renamed.passkey.name).toBe('Tablet')

        const removed = yield* auth.api.deletePasskey({
          body: { id: created.id },
          headers
        })
        expect(removed.status).toBe(true)

        const after = yield* auth.api.listPasskeys({ headers })
        expect(after).toHaveLength(0)
      })
    ))

  it('signs in with a passkey and opens a working session', () =>
    run(
      Effect.gen(function* () {
        const { cookieHeader } = yield* signUpSession('passkey@signin.test')
        const authenticator = makeAuthenticator()
        yield* Effect.promise(() => registerPasskey(cookieHeader, authenticator, 'Key'))

        const { verification, cookies } = yield* Effect.promise(() =>
          signInWithPasskey(authenticator)
        )
        expect(verification.response.user.email).toBe('passkey@signin.test')
        expect(verification.response.session).toBeDefined()

        // The session cookie the ceremony set is a real session: it reaches a
        // session-gated endpoint and names the same user.
        const auth = yield* Auth.Tag
        const listed = yield* auth.api.listPasskeys({
          headers: new Headers({ cookie: cookies })
        })
        expect(listed).toHaveLength(1)
        expect(listed[0]?.name).toBe('Key')
      })
    ))

  it('rejects an assertion whose challenge does not match the issued one', () =>
    run(
      Effect.gen(function* () {
        const { cookieHeader } = yield* signUpSession('passkey@tamper.test')
        const authenticator = makeAuthenticator()
        yield* Effect.promise(() => registerPasskey(cookieHeader, authenticator, 'Key'))
        const auth = yield* Auth.Tag

        const optionsResponse = yield* Effect.promise(() =>
          auth.instance.api.generatePasskeyAuthenticationOptions({
            returnHeaders: true
          })
        )
        // The ceremony answers a DIFFERENT challenge than the one stored in
        // the cookie — a replay with a stale clientDataJSON.
        const assertionResponse = yield* Effect.promise(() =>
          authenticator.authenticate({ challenge: 'an-old-challenge' })
        )
        const attempt = yield* Effect.promise(() =>
          auth.instance.api
            .verifyPasskeyAuthentication({
              body: { response: assertionResponse },
              headers: new Headers({
                cookie: responseCookies(optionsResponse.headers)
              })
            })
            .then(
              () => ({ refused: false }),
              () => ({ refused: true })
            )
        )
        expect(attempt.refused).toBe(true)
      })
    ))

  it('satisfies the two-factor requirement: TOTP-enabled users sign in without a code', () =>
    run(
      Effect.gen(function* () {
        const { cookieHeader } = yield* signUpSession('passkey@twofactor.test')
        const authenticator = makeAuthenticator()

        // Enable TOTP the same way the account panel does: enable → first
        // verified code flips `twoFactorEnabled`.
        const auth = yield* Auth.Tag
        const enabled = yield* Effect.promise(() =>
          auth.instance.api.enableTwoFactor({
            body: { password: 'correct-horse-battery-staple' },
            headers: new Headers({ cookie: cookieHeader }),
            returnHeaders: true
          })
        )
        if (enabled.response.method !== 'totp') {
          return yield* Effect.die('expected TOTP enable response')
        }
        const secret = new URL(enabled.response.totpURI).searchParams.get('secret')
        expect(secret).toBeTruthy()
        const { code } = yield* auth.api.generateTOTP({
          body: { secret: decodeUriSecret(secret ?? '') }
        })
        const verified = yield* Effect.promise(() =>
          auth.instance.api.verifyTOTP({
            body: { code },
            headers: new Headers({
              cookie: mergeCookies(cookieHeader, responseCookies(enabled.headers))
            }),
            returnHeaders: true
          })
        )
        // The first verified code rotates the session (same as the two-factor
        // suite): everything after this point carries the new cookie.
        const freshCookieHeader = mergeCookies(
          mergeCookies(cookieHeader, responseCookies(enabled.headers)),
          responseCookies(verified.headers)
        )

        // The passkey ceremony opens a session DIRECTLY — no twoFactorRedirect
        // hop exists on this path (ADR 0056): the two-factor plugin's after
        // hook matches the credential sign-in endpoints only.
        yield* Effect.promise(() =>
          registerPasskey(freshCookieHeader, authenticator, 'Key')
        )
        const { verification, cookies } = yield* Effect.promise(() =>
          signInWithPasskey(authenticator)
        )
        expect(verification.response.session).toBeDefined()

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, 'passkey@twofactor.test'))
        )
        expect(rows[0]?.twoFactorEnabled).toBe(true)

        // The challenge cookie is not a session: only the ceremony's session
        // cookie opens one (the set above proves it).
        expect(cookies).toContain('better-auth.session_token=')
      })
    ))
})
