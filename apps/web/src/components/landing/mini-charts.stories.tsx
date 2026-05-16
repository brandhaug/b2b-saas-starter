import type { Meta, StoryObj } from '@storybook/react-vite'
import { MiniBarChart } from './mini-bar-chart'
import { MiniLineChart } from './mini-line-chart'

function MiniChartsPreview() {
  return (
    <div className="grid gap-6">
      <div className="w-[28rem] rounded-md border border-border bg-card p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Readiness trend
        </p>
        <MiniLineChart
          data={[
            { week: 'W1', score: 32 },
            { week: 'W2', score: 41 },
            { week: 'W3', score: 49 },
            { week: 'W4', score: 58 },
            { week: 'W5', score: 64 },
            { week: 'W6', score: 71 },
            { week: 'W7', score: 78 }
          ]}
          xKey="week"
          lines={[{ key: 'score', color: 'var(--primary)' }]}
        />
      </div>
      <div className="w-[28rem] rounded-md border border-border bg-card p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Webhook deliveries
        </p>
        <MiniBarChart
          data={[
            { day: 'Mon', deliveries: 6 },
            { day: 'Tue', deliveries: 9 },
            { day: 'Wed', deliveries: 4 },
            { day: 'Thu', deliveries: 11 },
            { day: 'Fri', deliveries: 7 }
          ]}
          xKey="day"
          dataKey="deliveries"
          color="var(--primary)"
        />
      </div>
    </div>
  )
}

const meta = {
  title: 'Landing/MiniCharts',
  component: MiniChartsPreview
} satisfies Meta<typeof MiniChartsPreview>

export default meta
type Story = StoryObj<typeof meta>

export const LineAndBar: Story = {}
