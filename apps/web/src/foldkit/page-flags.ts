import { Schema } from 'effect'
import { deLocalizeUrl, localizeUrl } from '@b2b-saas-starter/i18n/runtime'
import { m } from '@b2b-saas-starter/i18n/messages'
import articles from 'virtual:foldkit-docs'
import searchArticles from 'virtual:docs-search'
import { type PageData } from '@/http/page-contract'
import { contentJsonLd } from '@/lib/json-ld'
import { type Flags } from './program'
import { Page as AuthPage } from './auth/model'
import { categoryName } from './docs/contracts'
import * as Workspace from './workspace'
import * as AccountAdmin from './account-admin'
import * as ApplicationShell from './shared/application-shell'
import { type Flags as ErrorFlags } from './error'

const decodeAuthPage = Schema.decodeUnknownOption(AuthPage)

function pageTitle(page: string, workspaceSlug?: string): string {
  return workspaceSlug === undefined
    ? `${page} | B2B SaaS Starter`
    : `${page} · ${workspaceSlug} | B2B SaaS Starter`
}

function authTitle(page: AuthPage): string {
  const titles = {
    'sign-in': m.public_meta_sign_in(),
    'sign-up': m.public_meta_sign_up(),
    'forgot-password': m.public_meta_forgot_password(),
    'reset-password': m.public_meta_reset_password(),
    'two-factor': m.public_meta_two_factor(),
    'email-code': m.public_meta_email_code(),
    'verify-email': m.public_meta_verify_email(),
    'magic-link': m.public_meta_magic_link(),
    'verify-authentication': m.security_verify_title()
  }
  return pageTitle(titles[page])
}

// oxlint-disable-next-line unicorn/throw-new-error -- Effect's tagged-error class factory.
export class FrontendPageMissing extends Schema.TaggedError<FrontendPageMissing>()(
  'FrontendPageMissing',
  { path: Schema.String, page: Schema.String }
) {}

/** Pure request-to-frontend mapping. Only this server-entry import reaches compiled article bodies. */
export function flagsForPage(url: URL, data: PageData): Flags {
  const path = deLocalizeUrl(url).pathname.replace(/\/$/, '') || '/'
  const canonicalUrl = new URL(url)
  canonicalUrl.search = ''
  canonicalUrl.hash = ''
  const base = {
    analyticsToken: data.root?.telemetry.cloudflareWebAnalyticsToken ?? null,
    locale: data.locale,
    presentation: data.presentation,
    canonical: localizeUrl(canonicalUrl, { locale: data.locale }).href
  }
  const shell = {
    signedIn: data.root?.signedIn ?? data.presentation.authenticated,
    locale: data.locale,
    docs: articles.map((article) => article.meta),
    path
  }
  if (data.error !== null || data.status >= 400) {
    if (data.session !== null && data.directory !== null) {
      const section = path.split('/')[3]
      const flags: ErrorFlags = {
        status: data.status,
        error: data.error,
        returnTo: `${path}${url.search}`,
        section:
          path.startsWith('/workspaces/') &&
          (section === 'audit' || section === 'api-tokens' || section === 'webhooks')
            ? section
            : undefined
      }
      const resolvedShell = ApplicationShell.flagsForPage(url, data, shell.docs)
      return {
        ...base,
        canonical: null,
        title: data.status === 404 ? m.shell_not_found() : m.shell_error(),
        page: {
          _tag: 'ApplicationError',
          flags,
          shell: { ...resolvedShell, viewer: null }
        }
      }
    }
    return {
      ...base,
      title: data.status === 404 ? m.shell_not_found() : m.shell_error(),
      page: { _tag: 'Error', flags: { status: data.status, error: data.error } }
    }
  }
  if (path === '/privacy' || path === '/terms') {
    return {
      ...base,
      title:
        path === '/privacy'
          ? m.public_legal_privacy_title()
          : m.public_legal_terms_title(),
      page: {
        _tag: 'Public',
        flags: {
          shell,
          page: {
            _tag: 'Legal',
            page: path === '/privacy' ? 'privacy' : 'terms',
            controller: data.root?.telemetry.privacyController ?? null
          }
        }
      }
    }
  }
  if (path === '/docs/search') {
    return {
      ...base,
      title: m.docs_search_title(),
      page: {
        _tag: 'Public',
        flags: {
          shell,
          page: {
            _tag: 'Docs',
            flags: {
              _tag: 'Search',
              query: (url.searchParams.get('q') ?? '').slice(0, 200),
              articles: searchArticles
            }
          }
        }
      }
    }
  }
  if (path.startsWith('/docs/')) {
    base.canonical = localizeUrl(canonicalUrl, { locale: 'en' }).href
    const article = articles.find(
      ({ meta }) => path === `/docs/${meta.category}/${meta.slug}`
    )
    if (article === undefined) {
      return {
        ...base,
        title: m.shell_not_found(),
        page: { _tag: 'Error', flags: { status: 404, error: null } }
      }
    }
    const siblings = articles.filter(
      (item) => item.meta.category === article.meta.category
    )
    const index = siblings.indexOf(article)
    const { meta, html, headings } = article
    const jsonLd = contentJsonLd({
      article: {
        '@type': 'TechArticle',
        headline: meta.frontmatter.title,
        description: meta.frontmatter.description,
        keywords: (meta.frontmatter.tags ?? []).join(', ')
      },
      breadcrumb: [
        m.public_home(),
        m.public_docs_title(),
        categoryName(meta.category),
        meta.frontmatter.title
      ]
    })
    return {
      ...base,
      title: `${meta.frontmatter.title} · ${m.public_docs_title()} · B2B SaaS Starter`,
      page: {
        _tag: 'Public',
        flags: {
          shell,
          page: {
            _tag: 'Docs',
            flags: {
              _tag: 'Article',
              meta,
              html,
              headings,
              jsonLd,
              prev: siblings[index - 1]?.meta ?? null,
              next: siblings[index + 1]?.meta ?? null
            }
          }
        }
      }
    }
  }
  const page = data.page
  if (page?._tag === 'help') {
    return {
      ...base,
      title: m.support_title(),
      page: {
        _tag: 'Public',
        flags: { shell, page: { _tag: 'Help', flags: page } }
      }
    }
  }
  const workspaceTitles = new Map(
    Object.entries({
      dashboard: m.public_meta_overview(),
      members: m.public_meta_members(),
      settings: m.public_meta_settings(),
      billing: m.public_meta_billing(),
      'api-tokens': m.public_meta_api_tokens(),
      webhooks: m.public_meta_webhooks(),
      audit: m.public_meta_audit(),
      assistant: m.public_meta_assistant(),
      suspended: m.nav_settings()
    })
  )
  const demoSection = path === '/demo' ? 'dashboard' : path.slice('/demo/'.length)
  const demo = path === '/demo' || path.startsWith('/demo/')
  if (demo && (demoSection === 'suspended' || !workspaceTitles.has(demoSection))) {
    return {
      ...base,
      title: m.shell_not_found(),
      page: { _tag: 'Error', flags: { status: 404, error: null } }
    }
  }
  if (demo || (page !== null && workspaceTitles.has(page._tag))) {
    const flags = Workspace.flagsForPage(deLocalizeUrl(url), data)
    return {
      ...base,
      canonical: null,
      title: pageTitle(
        demo
          ? m.public_meta_demo()
          : (workspaceTitles.get(flags.page._tag) ?? m.public_meta_overview()),
        flags.slug
      ),
      page: {
        _tag: 'Workspace',
        flags,
        shell: ApplicationShell.flagsForPage(url, data, shell.docs)
      }
    }
  }
  const accountTitles = new Map(
    Object.entries({
      directory: m.public_meta_workspaces(),
      account: m.public_meta_account(),
      'account-notifications': m.notification_preferences(),
      admin: m.public_meta_admin(),
      purchase: m.public_meta_pricing()
    })
  )
  if (page !== null && accountTitles.has(page._tag)) {
    return {
      ...base,
      canonical: null,
      title: pageTitle(accountTitles.get(page._tag) ?? m.public_meta_account()),
      page: {
        _tag: 'AccountAdmin',
        flags: AccountAdmin.flagsForPage(url, data),
        shell: ApplicationShell.flagsForPage(url, data, shell.docs)
      }
    }
  }
  if (page?._tag === 'pricing') {
    return {
      ...base,
      title: pageTitle(m.public_meta_pricing()),
      page: {
        _tag: 'Public',
        flags: { shell, page: { _tag: 'Pricing', flags: page.data } }
      }
    }
  }
  if (path === '/' && page?._tag === 'public') {
    return {
      ...base,
      title: m.landing_tagline(),
      page: {
        _tag: 'Public',
        flags: {
          shell,
          page: {
            _tag: 'Home',
            flags: {
              demo: page.demo,
              recentDocs: articles.slice(0, 4).map((article) => article.meta)
            }
          }
        }
      }
    }
  }
  if (page?._tag === 'auth' || page?._tag === 'verification') {
    let candidate = path.slice(1)
    if (path === '/sign-in/email-code') {
      candidate = 'email-code'
    }
    if (path === '/magic-link/verify') {
      candidate = 'magic-link'
    }
    const parsed = decodeAuthPage(candidate)
    if (parsed._tag === 'Some') {
      const flags = {
        page: parsed.value,
        search: url.search,
        turnstileSiteKey: page._tag === 'auth' ? page.turnstileSiteKey : null,
        socialProviders: page._tag === 'auth' ? page.socialProviders : [],
        emailVerified:
          page._tag === 'auth'
            ? page.emailVerified
            : (data.session?.user.emailVerified ?? false),
        twoFactorEnabled: data.session?.user.twoFactorEnabled ?? false,
        recovering: url.searchParams.get('recovering') === 'true',
        locale: data.locale,
        authenticated: data.presentation.authenticated
      }
      return {
        ...base,
        title: authTitle(parsed.value),
        page: { _tag: 'Auth', flags }
      }
    }
  }
  if (page?._tag === 'consent') {
    return {
      ...base,
      title: pageTitle(m.public_meta_oauth_consent()),
      page: { _tag: 'Consent', flags: { payload: page.data, search: url.search } }
    }
  }
  if (page?._tag === 'invitation') {
    return {
      ...base,
      title: pageTitle(m.public_meta_accept_invitation()),
      page: { _tag: 'Invitation', flags: page.data }
    }
  }
  if (page === null || page._tag === 'public') {
    return {
      ...base,
      title: m.shell_not_found(),
      page: { _tag: 'Error', flags: { status: 404, error: null } }
    }
  }
  // oxlint-disable-next-line effect/noThrowStatement -- Entry integration must fail explicitly until each known server page has a native implementation; never render home or a fake 404.
  throw new FrontendPageMissing({ path, page: page._tag })
}
