# Authorization and Merchant-isolation matrix

Generated from `capabilityOperations` and the shared access policy.

| Operation      | Owner active                     | Access Hold | Restricted Access                                    | Attributed impersonation | Cross-Merchant       |
| -------------- | -------------------------------- | ----------- | ---------------------------------------------------- | ------------------------ | -------------------- |
| Read           | allow                            | deny        | allow                                                | allow with provenance    | same-shape not found |
| Mutation       | allow                            | deny        | deny except billing recovery or existing commitments | allow with provenance    | same-shape not found |
| Search         | allow                            | deny        | allow                                                | allow with provenance    | same-shape not found |
| Bulk operation | allow                            | deny        | deny                                                 | allow with provenance    | same-shape not found |
| Export         | allow                            | deny        | allow                                                | allow with provenance    | same-shape not found |
| Callback       | correlated authority only        | deny        | deny                                                 | not applicable           | same-shape not found |
| Queued action  | correlated system authority only | deny        | deny except existing commitments                     | not applicable           | same-shape not found |

Every denied mutation is contract-tested to leave command/domain revision, history,
notification/outbox, financial, and success-audit facts unchanged.
