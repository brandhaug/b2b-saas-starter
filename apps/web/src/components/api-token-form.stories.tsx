import type { Meta, StoryObj } from '@storybook/react-vite'
import { ApiTokenForm } from './api-token-form'

const meta = {
  title: 'Forms/ApiTokenForm',
  component: ApiTokenForm,
  argTypes: {
    onCreated: { action: 'created' }
  },
  decorators: [
    (Story) => (
      <div className="w-[28rem]">
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof ApiTokenForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { workspaceSlug: 'starter-lab' }
}
