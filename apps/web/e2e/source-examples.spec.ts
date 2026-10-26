import { expect, test } from '@playwright/test'

test('architecture examples render current source with line-linked citations', async ({
  page
}) => {
  await page.goto('/docs/architecture/effect-v4-backbone')
  await expect(
    page.getByRole('heading', { name: 'Effect v4 backbone', exact: true })
  ).toBeVisible()
  await expect(
    page.locator('pre').filter({ hasText: 'export class WorkspaceContext' })
  ).toContainText("'@b2b-saas-starter/capabilities/WorkspaceContext'")
  await expect(
    page.locator('pre').filter({ hasText: 'export class WorkspaceNotFound' })
  ).toContainText('httpApiStatus: 404')
  await expect(
    page.getByRole('link', {
      name: /Source: packages\/capabilities\/src\/workspace-context.ts/
    })
  ).toHaveAttribute(
    'href',
    /\/blob\/master\/packages\/capabilities\/src\/workspace-context\.ts#L\d+-L\d+$/
  )
  await expect(
    page.getByRole('link', { name: /Source: packages\/capabilities\/src\/errors.ts/ })
  ).toHaveAttribute(
    'href',
    /\/blob\/master\/packages\/capabilities\/src\/errors\.ts#L\d+-L\d+$/
  )
})
