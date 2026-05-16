import type { Meta, StoryObj } from '@storybook/react-vite'
import { GitBranchIcon, KeyRoundIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SignInCard({
  errorMessage,
  githubEnabled
}: {
  readonly errorMessage?: string
  readonly githubEnabled?: boolean
}) {
  return (
    <Card className="w-[28rem]">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <p className="text-sm text-muted-foreground">
          Sign in with email and password, or use GitHub when configured.
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
        <Button type="button" variant="outline" disabled={!githubEnabled}>
          <GitBranchIcon className="size-4" />
          Continue with GitHub
        </Button>
        {!githubEnabled ? (
          <p className="text-xs text-muted-foreground">
            Configure GitHub OAuth secrets to enable.
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

export const WithGithubEnabled: Story = {
  args: { githubEnabled: true }
}

export const WithError: Story = {
  args: { errorMessage: 'Invalid email or password' }
}
