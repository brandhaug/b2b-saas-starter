import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type ModuleToggleRow = {
  readonly id: string
  readonly name: string
  readonly status: 'ready' | 'configuring' | 'unconfigured'
  readonly enabled: boolean
}

function SettingsPanel({ rows }: { readonly rows: readonly ModuleToggleRow[] }) {
  return (
    <Card className="w-[32rem]">
      <CardHeader>
        <CardTitle>Module state</CardTitle>
        <p className="text-xs text-muted-foreground">
          Toggle starter modules per workspace. Provider readiness is reflected on the
          right.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
          >
            <div className="grid gap-0.5">
              <Label
                htmlFor={`module-${row.id}`}
                className="text-sm font-medium leading-none"
              >
                {row.name}
              </Label>
              <Badge variant={row.status === 'ready' ? 'default' : 'secondary'}>
                {row.status}
              </Badge>
            </div>
            <Switch id={`module-${row.id}`} defaultChecked={row.enabled} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

const meta = {
  title: 'Workspace/SettingsPanel',
  component: SettingsPanel
} satisfies Meta<typeof SettingsPanel>

export default meta
type Story = StoryObj<typeof meta>

export const ModuleToggles: Story = {
  args: {
    rows: [
      { id: 'auth', name: 'Better Auth', status: 'ready', enabled: true },
      { id: 'email', name: 'Cloudflare Email', status: 'configuring', enabled: true },
      { id: 'webhooks', name: 'Outbound webhooks', status: 'ready', enabled: true },
      {
        id: 'assistant',
        name: 'Effect AI assistant',
        status: 'unconfigured',
        enabled: false
      },
      {
        id: 'billing',
        name: 'Billing provider',
        status: 'unconfigured',
        enabled: false
      }
    ]
  }
}
