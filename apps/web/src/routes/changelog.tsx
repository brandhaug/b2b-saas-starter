import { createFileRoute } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { changelog } from '@/lib/content'

export const Route = createFileRoute('/changelog')({
  component: ChangelogPage
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
                  {entry.version} · {entry.date}
                </p>
                <CardTitle>{entry.title}</CardTitle>
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
