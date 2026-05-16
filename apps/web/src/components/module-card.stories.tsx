import type { Meta, StoryObj } from '@storybook/react-vite'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const meta = {
  title: 'Starter/Module Card',
  component: Card
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Effect v4</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Typed services, schemas, and HTTP contracts.
        </p>
        <Badge>ready</Badge>
      </CardContent>
    </Card>
  )
}
