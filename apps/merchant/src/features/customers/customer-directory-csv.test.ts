import { describe, expect, it } from 'vitest'
import {
  encodeCustomerExportCsv,
  parseCustomerImportCsv
} from './customer-directory-csv.ts'

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

  it('quotes every minimized export cell', () => {
    expect(
      encodeCustomerExportCsv([
        {
          id: 'cur_one',
          name: 'Popescu, "Ana"',
          email: null,
          phone: '+40700000000',
          status: 'active',
          appointmentIds: ['apt_one', 'apt_two']
        }
      ])
    ).toContain('"Popescu, ""Ana"""')
  })
})
