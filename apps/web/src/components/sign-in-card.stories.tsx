import { type Meta, type StoryObj } from '@storybook/react-vite'
import { KeyRoundIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SignInCard({ errorMessage }: { readonly errorMessage?: string }) {
  return (
    <Card className="w-112">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <p className="text-sm text-muted-foreground">
          Sign in with your email and password.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="story-email">Email</Label>
          <Input
            id="story-email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="story-password">Password</Label>
          <Input id="story-password" type="password" autoComplete="current-password" />
        </div>
        <Button type="submit">
          <KeyRoundIcon className="size-4" /> Continue
        </Button>
        {errorMessage ? (
          <p className="text-xs text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

const meta = {
  title: 'Auth/SignInCard',
  component: SignInCard
} satisfies Meta<typeof SignInCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithError: Story = {
  args: { errorMessage: 'Invalid email or password' }
}
