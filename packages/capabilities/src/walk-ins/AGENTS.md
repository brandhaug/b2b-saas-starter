# Walk-ins

Shop-scoped customer queue capability. Shop `bookingConfigJson.walkIns` is the
configuration source; ordered active entries are the source of queue position and wait
projections. Enrollment captures a historical request/customer snapshot, emits a
protected acknowledgment and Notification Intent, and never creates an Appointment.

All reads and transitions require explicit Shop scope. Lifecycle history is append-only;
terminal entries do not re-enter the queue.
