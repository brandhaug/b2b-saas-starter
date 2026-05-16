import type { Meta, StoryObj } from '@storybook/react-vite'
import { FeatureCard } from './feature-card'
import { MiniLineChart } from './mini-line-chart'
import { TrendIndicator } from './trend-indicator'

const meta = {
  title: 'Landing/FeatureCard',
  component: FeatureCard,
  args: {
    title: 'Effect v4 application backbone',
    description: 'Typed services, schemas, and HTTP contracts as the runtime spine.'
  }
} satisfies Meta<typeof FeatureCard>

export default meta
type Story = StoryObj<typeof meta>

export const Plain: Story = {}

export const WithTrend: Story = {
  args: {
    title: 'Adoption readiness',
    description: 'Workspace module coverage across the starter capabilities.',
    children: (
      <div className="flex items-center justify-between">
        <span className="text-2xl font-semibold">78%</span>
        <TrendIndicator trend="up" />
      </div>
    )
  }
}

export const WithMiniChart: Story = {
  args: {
    title: 'Weekly readiness trend',
    description: 'Rolling readiness score for the Starter Lab workspace.',
    children: (
      <MiniLineChart
        data={[
          { day: 'Mon', score: 52 },
          { day: 'Tue', score: 58 },
          { day: 'Wed', score: 63 },
          { day: 'Thu', score: 68 },
          { day: 'Fri', score: 74 },
          { day: 'Sat', score: 76 },
          { day: 'Sun', score: 78 }
        ]}
        xKey="day"
        lines={[{ key: 'score', color: 'var(--primary)' }]}
      />
    )
  }
}
