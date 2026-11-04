import { assert, describe } from 'vite-plus/test'
import { createRuleHarness } from '../../test/harness.ts'

const rule = createRuleHarness('starter/no-ui-appearance-override')
const button = `import { Button } from '@/components/ui/button';`

// Failure matrix: import aliases/namespaces, shadowing, conditional/template/cn
// classes, variant prefixes and arbitrary values, inline styles, and layout/a11y
// false positives. Indirect variables and spreads remain a review boundary.
describe('starter/no-ui-appearance-override', () => {
  rule.valid(
    'does not interpret conditional predicates as classes',
    `${button} export const view = <Button className={cn(mode === 'text-only' ? 'w-full' : 'w-fit', { 'sr-only': mode === 'bg-card' })} />`,
    { filename: 'view.tsx' }
  )
  rule.invalid(
    'rejects consumer separator appearance',
    `import { ItemGroup } from '@/components/ui/item'; export const view = <ItemGroup className="divide-y divide-border" />`,
    undefined,
    { filename: 'view.tsx' }
  )
  rule.invalid(
    'rejects control appearance',
    `${button} export const view = <Button className="bg-card px-0 h-8" />`,
    (messages) => {
      assert.match(messages, /variant.*size/u)
    },
    { filename: 'view.tsx' }
  )
  rule.invalid(
    'resolves aliases',
    `import { Button as Action } from '@/components/ui/button'; export const view = <Action className="hover:text-destructive" />`,
    undefined,
    { filename: 'view.tsx' }
  )
  rule.invalid(
    'resolves namespace imports',
    `import * as UI from '../components/ui/button'; export const view = <UI.Button className="rounded-full" />`,
    undefined,
    { filename: 'view.tsx' }
  )
  rule.invalid(
    'checks conditional class composition',
    `${button} export const view = <Button className={cn('w-full', active && 'md:font-bold', { 'border-0': pending })} />`,
    undefined,
    { filename: 'view.tsx' }
  )
  rule.invalid(
    'checks template text and arbitrary selectors',
    `${button} export const view = <Button className={\`w-full [&_svg]:text-primary \${extra}\`} />`,
    undefined,
    { filename: 'view.tsx' }
  )
  rule.invalid(
    'checks arbitrary properties and important classes',
    `${button} export const view = <Button className="[color:red] !bg-card md:px-0!" />`,
    undefined,
    { filename: 'view.tsx' }
  )
  rule.invalid(
    'checks inline appearance styles',
    `${button} export const view = <Button style={{ color: 'red', padding: 0 }} />`,
    undefined,
    { filename: 'view.tsx' }
  )
  rule.valid(
    'permits layout and accessible visibility',
    `${button} export const view = <Button className="w-full md:hidden self-start mt-2 sr-only" aria-expanded={open} data-state="open" />`,
    { filename: 'view.tsx' }
  )
  rule.valid(
    'permits portal geometry and skeleton dimensions',
    `import { SheetContent } from '@/components/ui/sheet'; import { Skeleton } from '@/components/ui/skeleton'; export const view = <SheetContent className="overflow-y-auto data-[side=right]:w-full"><Skeleton className="h-4 w-32" /></SheetContent>`,
    { filename: 'view.tsx' }
  )
  rule.valid(
    'permits layout styles',
    `${button} export const view = <Button style={{ width: 200, marginTop: 8 }} />`,
    { filename: 'view.tsx' }
  )
  rule.valid(
    'ignores native and feature components',
    `import { Button } from './feature'; export const view = <Button className="bg-card"><span className="font-bold" /></Button>`,
    { filename: 'view.tsx' }
  )
  rule.valid(
    'does not inspect children as component classes',
    `${button} export const view = <Button className="w-full"><span className="font-bold" /></Button>`,
    { filename: 'view.tsx' }
  )
  rule.valid(
    'respects shadowed imports',
    `${button} export function View({ Button }) { return <Button className="bg-card" /> }`,
    { filename: 'view.tsx' }
  )
})
