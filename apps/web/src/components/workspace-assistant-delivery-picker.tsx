import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { statusLabel } from '@/lib/value-labels'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type AssistantInvestigationPorts } from './workspace-assistant-investigation'

export function DeliveryPicker({
  deliveries,
  value,
  onChange
}: {
  readonly deliveries: NonNullable<AssistantInvestigationPorts['deliveries']>
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  const selected = deliveries.find((delivery) => delivery.id === value)
  if (deliveries.length === 0) {
    return (
      <Input
        id="delivery-id"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }
  return (
    <Select value={value || null} onValueChange={(next) => onChange(next ?? '')}>
      <SelectTrigger id="delivery-id" className="w-full min-w-0">
        <SelectValue placeholder={m.assistant_select_delivery()}>
          {selected ? `${selected.eventType} · ${selected.id}` : value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {deliveries.map((delivery) => (
            <SelectItem key={delivery.id} value={delivery.id}>
              <span className="grid min-w-0 gap-1 whitespace-normal wrap-anywhere">
                <span>
                  {delivery.eventType} · {statusLabel(delivery.status)}
                </span>
                <span>{delivery.endpointUrl}</span>
                <span className="font-mono">{delivery.id}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
