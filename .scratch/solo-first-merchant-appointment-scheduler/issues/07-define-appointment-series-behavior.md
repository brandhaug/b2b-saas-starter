# Define Appointment Series Behavior

Type: grilling
Status: resolved
Blocked by: 06

## Question

How should a merchant-created Appointment Series generate and relate independent Appointments; which recurrence rules and limits are allowed; how do conflict, partial failure, cancellation, reassignment, schedule changes, and notifications behave; and what exactly do "this Appointment" and "this and future Appointments" change?

## Comments

### Resolution — 2026-07-30

An Appointment Series is an Owner-created, finite weekly recurrence plan and a durable grouping of otherwise independent Appointments. It repeats on the original Shop-local weekday and clock time every one through eight weeks. The Owner chooses a total of two through fifty-two Appointments; BeeSolo does not support never-ending, daily, monthly, multiple-weekday, or custom recurrence rules at launch. If exclusions leave only one proposed occurrence, the Owner creates an ordinary Merchant-Created Appointment instead of a series.

BeeSolo previews and materializes every member upfront. The preview shows the complete date range and every proposed Appointment, and the Owner may adjust or exclude individual occurrences before submission. Nonexistent or ambiguous Shop-local clock times caused by a timezone transition must be resolved in the preview, so each finalized member has exact start and end instants. No floating occurrence or background generator remains after creation.

One idempotent Appointment Series command creates the grouping and all finalized Appointments atomically. It revalidates every Active Service, snapshot, occupied interval, expected warning acknowledgement, and active conflict at commit. A proposed occurrence outside working time or across Blocked Time is an overridable warning; one explicit confirmation and optional shared override reason apply to every warned member. Overlap with another non-terminal Appointment is a hard conflict that must be adjusted or excluded. Commit atomically invalidates affected Time Slot Holds. If another Appointment wins a race or any validation or persistence step fails, the command creates no series, Appointment, history, Confirmation access, notification intent, or partial side effect.

Every created member receives its own identity, Appointment Revision, status, immutable Customer Details, Service, price, buffer, Provider, time, and notification snapshots, plus durable membership in the Appointment Series. The grouping preserves the recurrence facts and finalized membership; excluded preview proposals never become members. Each successful member creation writes its own Appointment History entry linked by the series operation identity, and idempotent replay adds nothing. BeeSolo has no reassignment behavior because its Merchant Owner is the sole active Provider.

After creation, Edit Appointment, Reschedule Appointment, Cancel Appointment, Complete Appointment, No Show, outcome correction, External Collection, and customer cancellation retain their ordinary Appointment-scoped contracts. An individually edited, rescheduled, or cancelled Appointment remains related to the series as an explicit exception and never changes another member. BeeSolo deliberately offers no generic **This and Future Appointments** scope. The customer may cancel only the Appointment reached through that Appointment's Confirmation and only under the ordinary customer policy.

Series cadence and membership are immutable after creation. The Owner cannot extend a series, change its interval, or propagate a new time, Customer Details, Services, or price across remaining members. Continuing beyond the final member or adopting a different cadence requires a new Appointment Series and a fresh complete preview. Later Schedule Rules, Blocked Time, Service, price, or catalog changes never move, reprice, regenerate, or cancel existing members; an affected Scheduled member independently becomes a Schedule Conflict under the ordinary rule.

**Cancel Remaining Series** is the sole bulk series lifecycle action and is available only to the authenticated Owner or an audited System Operator with that Owner's effective authority. It targets every still-Scheduled member, verifies every current Appointment Revision, and atomically cancels all of them or none. Completed, No Show, and already-Cancelled members remain unchanged. One cancellation category, optional Merchant-private note, and optional customer message govern the operation. For each affected Appointment with a net External Collection, the Owner records whether value was actually returned; matching Returned entries commit with the cancellations, while unreturned value remains truthful history and never blocks cancellation. Each affected Appointment receives a linked history entry under one operation identity.

Series creation queues one consolidated confirmation rather than one message per member; the later Transactional Notification Workflows decision owns exact channel, content, retries, and delivery behavior. Appointment reminders and individual Appointment changes remain Appointment-specific. Cancel Remaining Series queues one consolidated cancellation notice. Both consolidated notices send by default when an eligible contact channel exists, while **Don't Notify** requires explicit confirmation and a private suppression reason recorded across affected Appointment histories. Submission or delivery failure never rolls back a committed command.

Restricted Access blocks creation of a new Appointment Series but continues to permit ordinary handling of existing members and Cancel Remaining Series. Merchant Access Hold, revoked authentication, invalid impersonation, Merchant scoping, stale-revision rejection, and idempotency retain the rules from Define Merchant Appointment Operations.
