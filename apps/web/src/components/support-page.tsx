import { Link } from '@tanstack/react-router'
import { BookOpenIcon, LifeBuoyIcon, MailIcon } from 'lucide-react'
import { SupportDetails } from '@/components/support-details'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type SupportConfig } from '@/lib/support-config'
import { m } from '@b2b-saas-starter/i18n/messages'

export function SupportPage({ config }: { readonly config: SupportConfig }) {
  // A deployment with neither a helpdesk nor a support address has no
  // contact option to choose, so the lead says so instead of pointing at an
  // empty section — the notice is the lead here, not a footnote under it.
  const contactAvailable = Boolean(config.helpdeskUrl || config.email)
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto grid w-full max-w-3xl flex-1 gap-10 px-4 py-12 sm:px-6 outline-none"
    >
      <section className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">{m.support_title()}</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          {contactAvailable ? m.support_description() : m.support_unavailable()}
        </p>
      </section>
      {contactAvailable || config.helpCenterUrl ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {contactAvailable ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2" className="flex items-center gap-2">
                  <LifeBuoyIcon className="size-5" />
                  {m.support_contact_title()}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-sm text-muted-foreground">
                  {m.support_contact_description()}
                </p>
                {config.helpdeskUrl ? (
                  <a
                    className="font-medium underline underline-offset-4"
                    href={config.helpdeskUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {m.support_open_helpdesk()}
                    <span className="sr-only">{m.common_opens_new_tab()}</span>
                  </a>
                ) : null}
                {config.email ? (
                  <a
                    className="flex items-center gap-2 font-medium underline underline-offset-4"
                    href={`mailto:${encodeURIComponent(config.email)}`}
                  >
                    <MailIcon className="size-4" />
                    {config.email}
                  </a>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          {config.helpCenterUrl ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2" className="flex items-center gap-2">
                  <BookOpenIcon className="size-5" />
                  {m.support_help_center_title()}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <a
                  className="font-medium underline underline-offset-4"
                  href={config.helpCenterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {m.support_open_help_center()}
                  <span className="sr-only">{m.common_opens_new_tab()}</span>
                </a>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
      <section className="grid gap-3 border-t border-border pt-8">
        <h2 className="text-xl font-semibold">{m.support_details_title()}</h2>
        <p className="text-sm text-muted-foreground">
          {m.support_details_description()}
        </p>
        <SupportDetails routeName="help" appVersion={config.appVersion} />
      </section>
      {import.meta.env.DEV ? (
        <p className="text-xs text-muted-foreground">{m.support_development_hint()}</p>
      ) : null}
      <p className="text-sm">
        <Link
          to="/"
          className="inline-flex items-center underline underline-offset-4 max-md:min-h-11"
        >
          {m.shell_home()}
        </Link>
      </p>
    </main>
  )
}
