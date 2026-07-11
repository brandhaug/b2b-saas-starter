# Audit Event Log

Append-only Booking Product governance events. Merchant-scoped producers set
`merchantId`; system authentication events may leave it null. Mutation capabilities
use `prepareRecord` helpers so their write and audit event commit atomically.
