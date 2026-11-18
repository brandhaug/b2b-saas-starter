import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-unsignaled-poll')

describe('starter/no-unsignaled-poll', () => {
  for (const [name, poll] of [
    [
      'a spy called matcher',
      'await vi.waitFor(() => expect(assign).toHaveBeenCalled())'
    ],
    [
      'a negated spy matcher',
      'await vi.waitFor(() => expect(assign).not.toHaveBeenCalledWith(1))'
    ],
    [
      'a spy matcher in a block body',
      'await vi.waitFor(() => {\n    expect(assign).toHaveBeenCalledWith(1)\n  })'
    ],
    [
      'toHaveLength on a recorder',
      'await vi.waitFor(() => expect(calls.create).toHaveLength(1))'
    ],
    [
      'a mock path',
      'await vi.waitFor(() => expect(assign.mock.calls[0]).toEqual([1]))'
    ],
    ['a recorder size', 'await expect.poll(() => arrived.size).toBe(2)'],
    [
      'a recorder length with options',
      'await expect.poll(() => requests.length, { timeout: 5000 }).toBe(2)'
    ],
    [
      'a returned recorder',
      'await expect.poll(() => {\n    return spy.mock.calls\n  }).toHaveLength(1)'
    ],
    [
      'a polled array toHaveLength',
      'await expect.poll(() => requests).toHaveLength(2)'
    ],
    [
      'an optional-chained recorder',
      'await expect.poll(() => state?.calls.length).toBe(1)'
    ]
  ] as const) {
    rule.invalid(
      `rejects polling ${name}`,
      `it('hands off', async () => {
  ${poll}
})
`,
      (message) => {
        assert.include(message, 'deferred promise')
      }
    )
  }

  rule.valid(
    'allows polling a DOM query',
    `it('renders', async () => {
  await vi.waitFor(() =>
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  )
})
`
  )

  rule.valid(
    'allows polling a React ref',
    `it('mounts', async () => {
  await vi.waitFor(() => expect(ref.current).toHaveLength(1))
  await expect.poll(() => ref.current.length).toBe(1)
})
`
  )

  rule.valid(
    'allows polling non-recorder state',
    `it('settles', async () => {
  await expect.poll(() => state.status).toBe('ready')
  await vi.waitFor(() => expect(result).toEqual({ ok: true }))
})
`
  )

  rule.valid(
    'leaves multi-statement callbacks to review',
    `it('settles', async () => {
  await vi.waitFor(() => {
    const count = calls.length
    expect(count).toBe(1)
  })
})
`
  )

  rule.valid(
    'leaves Testing Library waitFor to review',
    `it('settles', async () => {
  await waitFor(() => expect(assign).toHaveBeenCalled())
})
`
  )

  rule.valid(
    'allows awaiting the signal',
    `it('hands off', async () => {
  const assigned = Promise.withResolvers()
  expect(await assigned.promise).toBe('url')
})
`
  )
})
