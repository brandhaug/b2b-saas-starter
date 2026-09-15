import { LightRays } from '@/components/landing/light-rays'
import { Link } from '@tanstack/react-router'
import { CheckIcon, ArrowUpRightIcon } from 'lucide-react'
import { type ReactNode } from 'react'
import { m } from '@b2b-saas-starter/i18n/messages'
import { LanguageSwitcher } from '@/components/language-switcher'

/** Dedicated entry surface for the two primary credential routes. */
export function AuthShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-background text-foreground">
      <LightRays />
      <a
        // oxlint-disable-next-line react-doctor/anchor-target-exists -- AuthCardForm owns the main-content landmark inside this shell.
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:underline"
      >
        {m.common_skip_to_content()}
      </a>
      <header className="relative mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-6 sm:px-10 lg:px-14">
        <Link to="/" className="inline-flex items-center gap-3">
          <img
            src="/assets/starter-logo.png"
            alt=""
            width={40}
            height={40}
            className="size-10 shrink-0"
          />
          <span className="text-sm font-semibold tracking-tight">B2B SaaS Starter</span>
        </Link>
        <Link
          to="/help"
          reloadDocument
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline max-md:min-h-11 max-md:py-3"
        >
          {m.public_meta_support()}
        </Link>
      </header>
      <div className="relative mx-auto grid w-full max-w-7xl flex-1 items-center px-6 py-10 outline-none sm:px-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(440px,0.8fr)] lg:gap-20 lg:px-14 lg:py-16">
        <section
          className="hidden min-h-140 flex-col justify-between border border-border bg-card/40 p-8 lg:flex xl:p-12"
          aria-labelledby="auth-brand-title"
        >
          <div>
            <h2
              id="auth-brand-title"
              className="max-w-lg text-4xl font-semibold leading-tight tracking-tight text-foreground xl:text-5xl"
            >
              {m.auth_design_build_on_proof()}
            </h2>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
              {m.auth_design_brand_description()}
            </p>
          </div>
          <ul
            className="grid gap-2 border-t border-border pt-6"
            aria-label={m.auth_design_capabilities_label()}
          >
            {[
              m.auth_design_capability_auth(),
              m.auth_design_capability_workspaces(),
              m.auth_design_capability_audit(),
              m.auth_design_capability_cloudflare()
            ].map((capability) => (
              <li
                key={capability}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <CheckIcon className="size-4 text-primary" aria-hidden="true" />
                {capability}
              </li>
            ))}
          </ul>
        </section>
        <section
          className="mx-auto w-full max-w-md"
          aria-label={m.auth_design_account_access()}
        >
          {children}
        </section>
      </div>
      <footer className="relative mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-3 border-t border-muted-foreground px-6 py-3 text-sm text-muted-foreground sm:px-10 lg:px-14">
        <span>{m.site_footer_tagline()}</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            to="/privacy"
            className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline"
          >
            {m.privacy()}
          </Link>
          <Link
            to="/terms"
            className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline"
          >
            {m.terms()}
          </Link>
          <LanguageSwitcher />
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
          >
            {m.auth_design_explore_starter()}{' '}
            <ArrowUpRightIcon className="size-3" aria-hidden="true" />
          </Link>
        </div>
      </footer>
    </div>
  )
}
