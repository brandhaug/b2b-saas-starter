import { createFileRoute } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { changelog } from '@/lib/content'

export const Route = createFileRoute('/changelog')({
  component: ChangelogPage,
  head: () => ({
    meta: [
      { title: 'Changelog | B2B SaaS Starter' },
      {
        name: 'description',
        content:
          'Release history for the B2B SaaS Starter: new capabilities, fixes, and breaking changes by version.'
      },
      { property: 'og:title', content: 'Changelog | B2B SaaS Starter' },
      {
        property: 'og:description',
        content:
          'Release history for the B2B SaaS Starter: new capabilities, fixes, and breaking changes by version.'
      }
    ]
  })
})

function ChangelogPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Changelog</h1>
        <div className="mt-8 grid gap-4">
          {changelog.map((entry) => (
            <Card key={entry.version}>
              <CardHeader>
                <p className="text-sm text-muted-foreground">
                  {entry.version} · <time dateTime={entry.date}>{entry.date}</time>
                </p>
                <CardTitle as="h2">{entry.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {entry.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </PublicLayout>
  )
}
