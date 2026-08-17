// Declaration merging lives in `.d.ts` files — see the note in `router-register.d.ts`.
// `sticky` marks the column that `DataTable` pins to the left edge.
import  { type CellData, type RowData, type TableFeatures } from '@tanstack/react-table'

declare module '@tanstack/react-table' {
  interface ColumnMeta<
    TFeatures extends TableFeatures,
    TData extends RowData,
    TValue extends CellData
  > {
    readonly sticky?: boolean
  }
}
