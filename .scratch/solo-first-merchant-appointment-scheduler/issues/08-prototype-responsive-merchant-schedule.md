# Prototype the Responsive Merchant Schedule and Composer

Type: prototype
Status: resolved
Blocked by: 06, 07

## Question

What responsive interaction model best fits BeeSolo's existing day ledger, seven-day strip, month date-picker, compact desktop card, and mobile sheets while adding Owner appointment creation and lifecycle actions, Appointment Series controls, and safe rescheduling without introducing Team-oriented Provider filters or a separate week-board layout?

## Comments

### Prototype handoff — 2026-07-30

The throwaway prototype is mounted inside the existing authenticated `/appointments` route and Merchant shell. Run it with `bun run dev:merchant`, then review:

- `?date=2026-07-30&variant=A` — **Ledger + focus panel**: the existing ledger remains primary, with a desktop next-appointment focus card and mobile action sheet.
- `?date=2026-07-30&variant=B` — **Time rail + command tray**: a visual single-day time rail with persistent appointment, series, move, and completion commands.
- `?date=2026-07-30&variant=C` — **Command-first agenda**: creation and late-entry commands lead, followed by a grouped operational agenda.

The floating arrows and keyboard Left/Right switch variants. All interactions are in memory and visibly marked as unsaved. Each variant reaches the same single-appointment composer, finite weekly series preview, lifecycle command surface, append-only collection entry point, and revision-aware reschedule warning. Prototype assets:

- [`responsive-merchant-schedule-prototype.tsx`](../../apps/merchant/src/features/appointments/prototype/responsive-merchant-schedule-prototype.tsx)
- [`responsive-merchant-schedule-prototype.css`](../../apps/merchant/src/features/appointments/prototype/responsive-merchant-schedule-prototype.css)

Human verdict required before resolution: choose the strongest base interaction model and call out any elements to borrow from the other variants. The ticket remains claimed until that live review is complete.

### Resolution — 2026-07-30

BeeSolo keeps **Variant A — Ledger + focus panel** as the responsive Merchant Schedule interaction model. The day ledger, seven-day strip, and month date-picker remain the schedule's primary hierarchy on both desktop and mobile. Desktop retains the compact card and adds a contextual focus panel that follows the selected Appointment; mobile keeps the ledger and opens Appointment details and actions in a bottom sheet. Neither surface introduces Provider filters, a week board, or a full month Appointment grid.

The primary **New** action opens one creation chooser with **New Appointment**, **New Appointment Series**, and **Record Completed Visit**. Series recurrence remains inside the shared composer and expands into the complete finite-occurrence preview before submission; it does not become a persistent schedule-level mode. Open ledger gaps may expose Variant B's contextual **Add here** affordance with the proposed start time prefilled, but BeeSolo does not adopt Variant B's time rail or persistent command tray. Variant C's explicit creation choices and clear grouped-agenda language may be reused where they improve comprehension, but its command-first hierarchy does not replace the schedule.

Selecting an Appointment drives the contextual focus panel or mobile detail sheet. Appointment-scoped edit, reschedule, Complete, No Show, cancellation, outcome correction, and External Collection actions remain behind that detail surface rather than occupying the day view. **Cancel Remaining Series** appears only when the selected Appointment belongs to a Series. Rescheduling previews current and proposed facts, preserves the original Appointment until commit, distinguishes hard overlap from overridable working-time or Blocked-Time warnings, requires acknowledgement and an optional private override reason for warnings, surfaces the expected Appointment Revision, and makes the customer notification choice explicit.

The prototype's in-memory fixtures, variant switcher, route search parameter, and throwaway UI files were removed after the verdict. Implementation must rewrite the chosen interaction against real capability queries and commands; prototype code is not production code.
