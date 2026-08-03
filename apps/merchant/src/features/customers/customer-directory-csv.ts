import type { CustomerImportRow } from '@b2b-saas-starter/capabilities/customer-directory'

const parseCells = (input: string): readonly (readonly string[])[] => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!
    if (quoted && character === '"' && input[index + 1] === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

export const parseCustomerImportCsv = (input: string): readonly CustomerImportRow[] =>
  parseCells(input)
    .filter(([name]) => Boolean(name))
    .map(([name = '', email = '', phone = '', externalReference = '']) => ({
      name,
      email: email || null,
      phone: phone || null,
      ...(externalReference ? { externalReference } : {})
    }))
