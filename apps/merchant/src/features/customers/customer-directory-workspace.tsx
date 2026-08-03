import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import { CustomerDirectoryListPanel } from './customer-directory-list-panel.tsx'
import { CustomerDirectoryRecordPanel } from './customer-directory-record-panel.tsx'
import { useCustomerDirectoryWorkspace } from './use-customer-directory-workspace.ts'

export function CustomerDirectoryWorkspace({
  initialRecords
}: {
  readonly initialRecords: readonly CustomerRecord[]
}) {
  const workspace = useCustomerDirectoryWorkspace(initialRecords)

  return (
    <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(24rem,1.2fr)]">
      <CustomerDirectoryListPanel workspace={workspace} />
      <CustomerDirectoryRecordPanel workspace={workspace} />
    </div>
  )
}
