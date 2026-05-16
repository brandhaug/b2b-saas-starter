import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type ReadinessRow = {
  readonly id: string
  readonly name: string
  readonly status: 'ready' | 'configuring' | 'unconfigured'
  readonly missingConfig: readonly string[]
}

function ReadinessCard({
  score,
  ready,
  total,
  rows
}: {
  readonly score: number
  readonly ready: number
  readonly total: number
  readonly rows: readonly ReadinessRow[]
}) {
  return (
    <Card className="w-[32rem]">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="grid gap-1">
          <CardTitle>Adoption readiness</CardTitle>
          <p className="text-xs text-muted-foreground">
            Module coverage across the workspace.
          </p>
        </div>
        <Badge variant="secondary">
          {score}% · {ready}/{total}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between rounded-md border border-border p-3"
          >
            <div>
              <p className="text-sm font-medium">{row.name}</p>
              <p className="text-xs text-muted-foreground">
                {row.missingConfig.length === 0
                  ? 'Fully configured'
                  : `Missing: ${row.missingConfig.join(', ')}`}
              </p>
            </div>
            <Badge variant={row.status === 'ready' ? 'default' : 'secondary'}>
              {row.status}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

const meta = {
  title: 'Workspace/ReadinessCard',
  component: ReadinessCard
} satisfies Meta<typeof ReadinessCard>

export default meta
type Story = StoryObj<typeof meta>

export const HighlyReady: Story = {
  args: {
    score: 86,
    ready: 6,
    total: 7,
    rows: [
      { id: 'auth', name: 'Better Auth', status: 'ready', missingConfig: [] },
      { id: 'db', name: 'Drizzle on D1', status: 'ready', missingConfig: [] },
      { id: 'email', name: 'Cloudflare Email', status: 'ready', missingConfig: [] },
      { id: 'mcp', name: 'MCP discovery', status: 'ready', missingConfig: [] },
      { id: 'webhook', name: 'Outbound webhooks', status: 'ready', missingConfig: [] },
      { id: 'ai', name: 'Effect AI assistant', status: 'ready', missingConfig: [] },
      {
        id: 'billing',
        name: 'Billing provider',
        status: 'unconfigured',
        missingConfig: ['STRIPE_SECRET_KEY']
      }
    ]
  }
}

export const PartiallyReady: Story = {
  args: {
    score: 43,
    ready: 3,
    total: 7,
    rows: [
      { id: 'auth', name: 'Better Auth', status: 'ready', missingConfig: [] },
      { id: 'db', name: 'Drizzle on D1', status: 'ready', missingConfig: [] },
      { id: 'mcp', name: 'MCP discovery', status: 'ready', missingConfig: [] },
      {
        id: 'email',
        name: 'Cloudflare Email',
        status: 'configuring',
        missingConfig: ['EMAIL_FROM_ADDRESS']
      },
      {
        id: 'webhook',
        name: 'Outbound webhooks',
        status: 'configuring',
        missingConfig: ['endpoints']
      },
      {
        id: 'ai',
        name: 'Effect AI assistant',
        status: 'unconfigured',
        missingConfig: ['OPENAI_API_KEY']
      },
      {
        id: 'billing',
        name: 'Billing provider',
        status: 'unconfigured',
        missingConfig: ['STRIPE_SECRET_KEY']
      }
    ]
  }
}
