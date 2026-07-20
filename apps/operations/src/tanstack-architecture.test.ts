import { readdir, readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

const appFile = (path: string) => new URL(`../${path}`, import.meta.url)

it('deploys the Operations App through the repository TanStack Start boundary', async () => {
  const [packageJson, viteConfig, router, server, routeTree, httpRoutes] =
    await Promise.all([
      readFile(appFile('package.json'), 'utf8'),
      readFile(appFile('vite.config.ts'), 'utf8'),
      readFile(appFile('src/router.tsx'), 'utf8'),
      readFile(appFile('src/server.ts'), 'utf8'),
      readFile(appFile('src/routeTree.gen.ts'), 'utf8'),
      Promise.all(
        [
          'src/routes/ready.ts',
          'src/routes/api.auth.$.ts',
          'src/routes/api.operations.$.ts',
          'src/routes/api.merchants.$.ts',
          'src/routes/api.members.search.ts',
          'src/routes/__local.operator-invitation-email.ts'
        ].map((path) => readFile(appFile(path), 'utf8'))
      )
    ])
  const manifest = JSON.parse(packageJson) as {
    readonly scripts: Record<string, string>
    readonly dependencies: Record<string, string>
  }

  expect(manifest.dependencies).toMatchObject({
    '@tanstack/react-router': expect.any(String),
    '@tanstack/react-start': expect.any(String),
    react: expect.any(String),
    'react-dom': expect.any(String)
  })
  expect(manifest.scripts.dev).toContain('vite')
  expect(manifest.scripts.build).toBe('vite build')
  expect(viteConfig).toContain('tanstackStart()')
  expect(router).toContain('createRouter')
  expect(server).toContain('@tanstack/react-start/server-entry')
  expect(httpRoutes.every((route) => route.includes('createFileRoute'))).toBe(true)
  for (const route of [
    '/sign-in',
    '/verify-totp',
    '/enroll/security',
    '/operators',
    '/operators/invitations/new',
    '/audit/$eventId',
    '/merchants/$merchantId',
    '/merchants/$merchantId/members/$memberId'
  ]) {
    expect(routeTree).toContain(`'${route}'`)
  }
  expect(routeTree).toContain('routeTree')
})

it('keeps browser page rendering exclusively in TanStack React routes', async () => {
  const [sourceFiles, worker, enrollment, management] = await Promise.all([
    readdir(appFile('src')),
    readFile(appFile('src/index.ts'), 'utf8'),
    readFile(appFile('src/operator-enrollment.ts'), 'utf8'),
    readFile(appFile('src/operator-management.ts'), 'utf8')
  ])

  expect(sourceFiles).not.toContain('operations-response.ts')
  expect(sourceFiles).not.toContain('worker.browser.test.ts')
  expect(sourceFiles).not.toContain('operator-management.browser.test.ts')
  for (const boundary of [worker, enrollment, management]) {
    expect(boundary).not.toContain('text/html')
    expect(boundary).not.toMatch(/\bhtml\(/)
    expect(boundary).not.toContain('<!doctype')
  }
})
