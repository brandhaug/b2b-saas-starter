/// <reference types="bun-types" />
import { Effect } from 'effect'
import {
  makeSystemOperatorMaintenance,
  type OperatorMaintenanceDatabase,
  type OperatorMaintenanceEnvironment,
  type OperatorMaintenanceStatement,
  type OperatorRole
} from '@b2b-saas-starter/capabilities/governance'

type Command = 'bootstrap' | 'recover'

type CommandInput = {
  readonly command: Command
  readonly actor: string
  readonly environment: OperatorMaintenanceEnvironment
  readonly remote: boolean
  readonly email: string
  readonly confirmedEmail: string
  readonly roles: readonly OperatorRole[]
}

const usage = `Usage:
  bun run operator:bootstrap -- --environment local --email EMAIL --confirm-email EMAIL --actor ACTOR --roles ROLE[,ROLE]
  bun run operator:bootstrap -- --environment production --remote --email EMAIL --confirm-email EMAIL --actor ACTOR --roles ROLE[,ROLE]
  bun run operator:recover -- --environment local --email EMAIL --confirm-email EMAIL --actor ACTOR
  bun run operator:recover -- --environment production --remote --email EMAIL --confirm-email EMAIL --actor ACTOR`

const valueAfter = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag)
  return index < 0 ? undefined : args[index + 1]
}

export const parseSystemOperatorCommand = (args: readonly string[]): CommandInput => {
  const command = args[0]
  if (command !== 'bootstrap' && command !== 'recover') throw new Error(usage)
  const environment = valueAfter(args, '--environment')
  if (environment !== 'local' && environment !== 'production')
    throw new Error(`--environment must be exactly local or production\n\n${usage}`)
  const email = valueAfter(args, '--email')
  const confirmedEmail = valueAfter(args, '--confirm-email')
  const actor = valueAfter(args, '--actor')
  if (!email || !confirmedEmail || !actor)
    throw new Error(`--email, --confirm-email, and --actor are required\n\n${usage}`)
  const roles = (valueAfter(args, '--roles') ?? '')
    .split(',')
    .map((role) => role.trim())
    .filter((role): role is OperatorRole => role.length > 0)
  if (command === 'bootstrap' && roles.length === 0)
    throw new Error(`bootstrap requires --roles\n\n${usage}`)
  if (command === 'recover' && args.includes('--roles'))
    throw new Error('recovery does not accept --roles')
  return {
    command,
    actor,
    environment,
    remote: args.includes('--remote'),
    email,
    confirmedEmail,
    roles
  }
}

const sqlLiteral = (value: unknown): string => {
  if (value === null) return 'NULL'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  throw new Error(`unsupported D1 command parameter: ${typeof value}`)
}

const compile = (statement: OperatorMaintenanceStatement): string =>
  statement.sql.replace(/\?(\d+)/g, (_, rawIndex: string) => {
    const index = Number(rawIndex) - 1
    if (index < 0 || index >= statement.params.length)
      throw new Error(`missing SQL parameter ?${rawIndex}`)
    return sqlLiteral(statement.params[index])
  })

type WranglerResult = {
  readonly results: readonly Record<string, unknown>[]
  readonly meta: { readonly changes?: number }
}

type WranglerOperatorExecutor = (input: {
  readonly remote: boolean
  readonly sql: string
}) => Promise<readonly WranglerResult[]>

const executeWrangler: WranglerOperatorExecutor = async (input) => {
  const process = Bun.spawn(
    [
      'bunx',
      'wrangler',
      'd1',
      'execute',
      'b2b-saas-starter',
      input.remote ? '--remote' : '--local',
      '--yes',
      '--json',
      '--config=packages/db/wrangler.jsonc',
      `--command=${input.sql}`
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || 'Wrangler D1 command failed')
  return JSON.parse(stdout) as readonly WranglerResult[]
}

export const makeWranglerOperatorMaintenanceDatabase = (
  remote: boolean,
  execute: WranglerOperatorExecutor = executeWrangler
): OperatorMaintenanceDatabase => ({
  first: async <Row>(statement: OperatorMaintenanceStatement) => {
    const batches = await execute({ remote, sql: compile(statement) })
    return (batches[0]?.results[0] as Row | undefined) ?? null
  },
  batch: async (statements) => {
    const batches = await execute({
      remote,
      sql: statements
        .flatMap((statement) => [compile(statement), 'SELECT changes() AS changes'])
        .join(';\n')
    })
    return statements.map((_, index) => {
      const changes = batches[index * 2 + 1]?.results[0]?.changes
      if (typeof changes !== 'number')
        throw new Error('Wrangler D1 did not return mutation changes')
      return { changes }
    })
  }
})

export const runSystemOperatorCommand = async (input: CommandInput) => {
  const maintenance = makeSystemOperatorMaintenance(
    makeWranglerOperatorMaintenanceDatabase(input.remote)
  )
  const result = await Effect.runPromise(
    input.command === 'bootstrap'
      ? maintenance.bootstrap({
          actor: input.actor,
          environment: input.environment,
          remote: input.remote,
          email: input.email,
          confirmedEmail: input.confirmedEmail,
          roles: input.roles
        })
      : maintenance.recover({
          actor: input.actor,
          environment: input.environment,
          remote: input.remote,
          email: input.email,
          confirmedEmail: input.confirmedEmail
        })
  )
  process.stdout.write(
    `${input.command} accepted for ${input.email}: operator ${result.operatorId}; security enrollment required\n`
  )
}

if (import.meta.main) {
  try {
    if (process.argv.includes('--help')) {
      process.stdout.write(`${usage}\n`)
    } else {
      await runSystemOperatorCommand(parseSystemOperatorCommand(process.argv.slice(2)))
    }
  } catch (cause) {
    const message =
      cause && typeof cause === 'object' && 'reason' in cause
        ? String(cause.reason)
        : cause instanceof Error
          ? cause.message
          : String(cause)
    process.stderr.write(`System Operator maintenance rejected: ${message}\n`)
    process.exitCode = 1
  }
}
