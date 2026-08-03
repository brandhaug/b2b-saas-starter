import { describe, expect, it } from 'vitest'
import { parseCustomerImportCsv } from './customer-directory-csv.ts'

describe('Customer Directory CSV', () => {
  it('parses quoted commas, embedded newlines, and escaped quotes', () => {
    expect(
      parseCustomerImportCsv(
        '"Popescu, Ana",ana@example.com,+40700000000\n"Ion\nIonescu","ion""test@example.com",'
      )
    ).toEqual([
      {
        name: 'Popescu, Ana',
        email: 'ana@example.com',
        phone: '+40700000000'
      },
      { name: 'Ion\nIonescu', email: 'ion"test@example.com', phone: null }
    ])
  })
})
