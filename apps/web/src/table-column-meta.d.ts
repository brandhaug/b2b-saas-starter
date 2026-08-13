// Declaration merging lives in `.d.ts` files — see the note in `router-register.d.ts`.
// `sticky` marks the column that `DataTable` pins to the left edge.
import type { RowData } from '@tanstack/react-table'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    readonly sticky?: boolean
  }
}
