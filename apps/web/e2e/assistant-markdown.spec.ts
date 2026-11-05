import { type WebSocketRoute } from '@playwright/test'
import { expect, signInWithPassword, test } from './authentication'
import { hasLocalD1State } from '../src/lib/local-d1-state'
import { type ConversationAnswer } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'

// Rendering fixture only: the real route/auth/create/delete run against local D1.
// Socket snapshots control model text; they do not claim to test stored inference.
test('renders partial and saved Markdown without remote images or page overflow', async ({
  page
}, testInfo) => {
  test.skip(!hasLocalD1State(), 'requires migrated and seeded local D1')
  const errors: Array<Error> = []
  const imageRequests: Array<string> = []
  page.on('pageerror', (error) => errors.push(error))
  page.on('request', (request) => {
    if (request.url().includes('images.example')) {
      imageRequests.push(request.url())
    }
  })
  const answer: ConversationAnswer = {
    id: 'markdown-answer',
    questionId: 'markdown-question',
    createdAt: '2026-11-01T10:00:00.000Z',
    deadline: 0,
    status: 'Running',
    completedAt: null,
    reason: null,
    text: '## Delivery result\n\n```ts\nconst status = "queued"',
    provider: 'Markdown fixture',
    modelId: 'offline',
    providerRequestId: null,
    finishReason: null,
    inputTokens: null,
    outputTokens: null,
    omittedExchanges: 0,
    evidence: {
      taskId: 'task-markdown',
      sourceId: 'delivery-markdown',
      observedAt: '2026-11-01T09:00:00.000Z',
      text: 'Observed evidence'
    }
  }
  let current: ConversationAnswer = answer
  let socket: WebSocketRoute | undefined
  function snapshot() {
    return JSON.stringify({
      type: 'conversation_snapshot',
      history: {
        policyRevision: 1,
        nextCursor: null,
        items: [
          {
            question: {
              id: 'markdown-question',
              createdAt: answer.createdAt,
              text: '**Keep my question literal**',
              taskId: null
            },
            attempts: [current]
          }
        ]
      }
    })
  }
  await page.routeWebSocket('**/api/assistant/*/connect', (route) => {
    socket = route
    route.send(snapshot())
  })
  await signInWithPassword(
    page,
    'engineer@example.com',
    '/workspaces/starter-lab/assistant'
  )
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .first()
    .click()
  await expect(page).toHaveURL(/conversationId=conversation_/)
  await expect(page.locator('pre code')).toContainText('const status = "queued"')
  await expect(
    page.getByText('**Keep my question literal**', { exact: true })
  ).toBeVisible()
  const text = [
    '## Delivery result',
    '',
    '- **Queued** for delivery',
    '- Delivery has not been confirmed',
    '',
    'Preserve `"a  b"` in inline code.',
    '',
    'Evidence[^source]. Repeated evidence[^source].',
    '',
    '[^source]: Saved observation.',
    '',
    '```ts',
    `const endpoint = "https://example.com/${'long-path/'.repeat(20)}"`,
    '```',
    '',
    '| Status | Attempts |',
    '| --- | --- |',
    '| Queued | 2 |',
    '',
    '[Read the docs](https://example.com/docs)',
    '',
    '[Unsafe](javascript:alert%281%29)',
    '',
    '![Evidence diagram](https://images.example/pixel.png)',
    '',
    '<script>window.markdownExecuted = true</script>'
  ].join('\n')
  current = {
    ...answer,
    text,
    status: 'Completed',
    completedAt: '2026-11-01T10:01:00.000Z'
  }
  expect(socket).toBeDefined()
  socket?.send(snapshot())
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
  await expect(page.locator('code').filter({ hasText: '"a  b"' })).toHaveCSS(
    'white-space',
    'pre-wrap'
  )
  await expect(
    page.getByRole('link', { name: 'Back to reference 1, occurrence 1', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Back to reference 1, occurrence 2', exact: true })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Read the docs' })).toHaveAttribute(
    'href',
    'https://example.com/docs'
  )
  await expect(page.getByRole('link', { name: 'Unsafe' })).toHaveCount(0)
  await expect(page.getByText('Evidence diagram', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Markdown fixture · offline', { exact: true })
  ).toBeVisible()
  await expect(page.getByText(/delivery-markdown/)).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('assistant-markdown-desktop.png'),
    fullPage: true
  })
  await page.reload()
  await page
    .locator('header [data-slot="select-trigger"]:enabled')
    .waitFor({ state: 'attached' })
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('pre')).toHaveAttribute('tabindex', '0')
  await page.locator('pre').focus()
  await expect(page.locator('pre')).toBeFocused()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true)
  expect(imageRequests).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath('assistant-markdown-mobile.png'),
    fullPage: true
  })
  await page.getByRole('button', { name: 'Delete conversation', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete conversation', exact: true })
    .click()
  await expect(page).not.toHaveURL(/conversationId=/)
})
