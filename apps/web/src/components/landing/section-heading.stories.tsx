import type { Meta, StoryObj } from '@storybook/react-vite'
import { SectionHeading } from './section-heading'

const meta = {
  title: 'Landing/SectionHeading',
  component: SectionHeading
} satisfies Meta<typeof SectionHeading>

export default meta
type Story = StoryObj<typeof meta>

export const Architecture: Story = {
  args: {
    badge: 'Architecture',
    title: 'Cloudflare-first capability surface',
    description:
      'Each starter capability is exposed as REST, MCP, and assistant tools backed by one Effect service layer.'
  }
}

export const Pricing: Story = {
  args: {
    badge: 'Pricing',
    title: 'Predictable usage-based pricing',
    description:
      'Plans are public; billing is wired through env-gated provider modules so the starter ships open by default.'
  }
}
