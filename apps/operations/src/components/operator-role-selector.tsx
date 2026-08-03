import {
  operatorRoleOptions,
  type OperatorRole
} from '@b2b-saas-starter/capabilities/operations'

export function OperatorRoleSelector({
  legend,
  selectedRoles = []
}: {
  readonly legend: string
  readonly selectedRoles?: readonly OperatorRole[]
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      {operatorRoleOptions.map((role) => (
        <label className="flex gap-2 text-sm" key={role.value}>
          <input
            defaultChecked={selectedRoles.includes(role.value)}
            name="roles"
            type="checkbox"
            value={role.value}
          />
          {role.label}
        </label>
      ))}
    </fieldset>
  )
}
