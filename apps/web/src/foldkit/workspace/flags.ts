import { Schema } from 'effect'
import { type PageData } from '@/http/page-contract'
import { demoFixtures } from '@/lib/demo-fixtures'
import { type Flags, WorkspacePage } from './model'
import { auditPage } from './preview'
const decodePage = Schema.decodeUnknownSync(Schema.toType(WorkspacePage))

export function flagsForPage(url: URL, data: PageData): Flags {
  const segments = url.pathname.split('/').filter(Boolean)
  const demoIndex = segments.indexOf('demo')
  const preview = demoIndex !== -1
  if (preview) {
    const section = segments[demoIndex + 1] ?? 'overview'
    let page: WorkspacePage
    switch (section) {
      case 'members': {
        page = { _tag: 'members', data: demoFixtures.members }
        break
      }
      case 'settings': {
        page = { _tag: 'settings', data: demoFixtures.settings }
        break
      }
      case 'billing': {
        page = { _tag: 'billing', data: demoFixtures.billing }
        break
      }
      case 'api-tokens': {
        page = { _tag: 'api-tokens', data: demoFixtures.apiTokens }
        break
      }
      case 'webhooks': {
        page = { _tag: 'webhooks', data: demoFixtures.webhooks }
        break
      }
      case 'audit': {
        page = auditPage(url)
        break
      }
      case 'assistant': {
        page = { _tag: 'assistant', data: demoFixtures.assistant }
        break
      }
      default: {
        page = { _tag: 'dashboard', data: demoFixtures.dashboard }
        break
      }
    }
    return {
      page,
      slug: demoFixtures.dashboard.workspace.slug,
      actorUserId: 'usr_demo',
      preview,
      url: url.href
    }
  }
  return {
    page: decodePage(data.page),
    slug: segments[segments.indexOf('workspaces') + 1] ?? '',
    actorUserId: data.session?.user.id ?? '',
    preview,
    url: url.href
  }
}
