# Authorization and Merchant-isolation matrix

Generated from the Merchant capability inventory and bounded-context Restricted Access policies.

| Capability            | Operation      | Required authority   | Owner | Access Hold | Restricted Access                     | Impersonation         | Cross-Merchant       |
| --------------------- | -------------- | -------------------- | ----- | ----------- | ------------------------------------- | --------------------- | -------------------- |
| merchant-catalog      | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| merchant-catalog      | mutation       | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| merchant-catalog      | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| merchant-catalog      | bulk-operation | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| merchant-catalog      | export         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| scheduling            | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| scheduling            | mutation       | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| scheduling            | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| scheduling            | bulk-operation | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| appointment           | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| appointment           | mutation       | owner-session        | allow | deny        | deny; registered: existing-commitment | allow with provenance | same-shape not found |
| appointment           | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| appointment           | bulk-operation | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| appointment           | export         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| appointment           | callback       | callback-correlation | deny  | deny        | deny                                  | deny                  | same-shape not found |
| appointment           | queued-action  | claimed-work         | deny  | deny        | deny                                  | deny                  | same-shape not found |
| customer-directory    | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| customer-directory    | mutation       | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| customer-directory    | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| customer-directory    | bulk-operation | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| customer-directory    | export         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| merchant-subscription | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| merchant-subscription | mutation       | owner-session        | allow | deny        | deny; registered: billing-recovery    | allow with provenance | same-shape not found |
| merchant-subscription | callback       | callback-correlation | deny  | deny        | deny                                  | deny                  | same-shape not found |
| merchant-subscription | queued-action  | claimed-work         | deny  | deny        | deny                                  | deny                  | same-shape not found |
| notifications         | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| notifications         | mutation       | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| notifications         | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| notifications         | bulk-operation | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| notifications         | callback       | callback-correlation | deny  | deny        | deny                                  | deny                  | same-shape not found |
| notifications         | queued-action  | claimed-work         | deny  | deny        | deny                                  | deny                  | same-shape not found |
| waiting-list          | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| waiting-list          | mutation       | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| waiting-list          | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| waiting-list          | bulk-operation | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| waiting-list          | queued-action  | claimed-work         | deny  | deny        | deny                                  | deny                  | same-shape not found |
| walk-ins              | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| walk-ins              | mutation       | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| walk-ins              | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| walk-ins              | bulk-operation | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| reporting-export      | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| reporting-export      | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| reporting-export      | export         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| reporting-export      | queued-action  | claimed-work         | deny  | deny        | deny                                  | deny                  | same-shape not found |
| privacy-request       | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| privacy-request       | mutation       | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| privacy-request       | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| privacy-request       | export         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| privacy-request       | queued-action  | claimed-work         | deny  | deny        | deny                                  | deny                  | same-shape not found |
| developer-platform    | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| developer-platform    | mutation       | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| developer-platform    | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| developer-platform    | callback       | callback-correlation | deny  | deny        | deny                                  | deny                  | same-shape not found |
| developer-platform    | queued-action  | claimed-work         | deny  | deny        | deny                                  | deny                  | same-shape not found |
| operations            | read           | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| operations            | mutation       | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |
| operations            | search         | owner-session        | allow | deny        | allow                                 | allow with provenance | same-shape not found |
| operations            | bulk-operation | owner-session        | allow | deny        | deny                                  | allow with provenance | same-shape not found |

Denied mutations must leave domain, notification, financial, outbox, and success-audit facts unchanged.
