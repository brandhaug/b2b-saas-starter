import type { Meta, StoryObj } from '@storybook/react-vite'
import { TrendIndicator } from './trend-indicator'

const meta = {
  title: 'Landing/TrendIndicator',
  component: TrendIndicator
} satisfies Meta<typeof TrendIndicator>

export default meta
type Story = StoryObj<typeof meta>

export const Up: Story = { args: { trend: 'up' } }
export const Stable: Story = { args: { trend: 'stable' } }
export const Down: Story = { args: { trend: 'down' } }
