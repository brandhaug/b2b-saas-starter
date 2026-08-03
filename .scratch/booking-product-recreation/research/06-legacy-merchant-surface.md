# Legacy Merchant Surface Evidence

## Question

Which behaviors and information-architecture signals in `/Users/hassan/Desktop/ssqu/recreate/apps/app` should inform the minimum Merchant App prototype without copying the legacy product wholesale?

## Route and Navigation Evidence

- `sources/js/app/shopRoutes.jsx` redirects `/` to `/appointments`. The merchant's returning-user home is operational, not an onboarding or catalog dashboard.
- `sources/js/app/app.jsx` orders the primary navigation as Appointments, Clients, Staff, Services, Products, Reports, Engage, Help, Settings, and later optional modules. The first-slice reduction keeps Appointments, Customers, Providers, Services, Availability, and Settings and drops non-booking modules.
- `sources/js/app/sidebar/header/shopsContainer.js` and the sidebar shell expose shop switching. The target first slice does not copy this because the settled storage boundary has no Shop or Brand rows.

## Business and Booking Configuration

- `sources/js/app/main/shops/ShopForm.jsx` is the legacy configuration hub. It mixes public identity and contact fields, timezone, address, recurring schedules, days off, any-barber booking, booking/payment choices, notifications, POS, payroll, inventory, fees, and many feature flags in one long form.
- `sources/js/app/main/shops/bookingSettings.jsx` makes booking-without-payment and book-with-card mutually exclusive.
- The target surface decomposes this mega-form. Public identity and publication live under Settings or guided setup; Provider Schedule Rules live under Availability; Provider Preference and Checkout Policy retain only the first-slice choices.

## Services

- `sources/js/app/main/services/components/ServicesWrapper.jsx` and `Actions.jsx` implement an explicit two-step flow: Service details, then assignment.
- `sources/js/app/main/services/components/ServiceDetailsForm.jsx` edits name, description, category, tax, duration, price, visibility, prepayment, and kiosk behavior.
- `sources/js/app/main/services/components/Assignments.jsx` assigns a Service across locations and barbers, with per-assignment duration, price, visibility, prepayment, and kiosk overrides.
- The target keeps the two-step interaction signal because Service-to-Provider eligibility is first-slice persistence. It removes location assignment, tax, kiosk, and per-provider price/duration/payment overrides.

## Providers

- `sources/js/app/main/barbers/formBarbers/barberForm/components/BarberForm.jsx` uses tabs for Profile, Services, Notifications, Schedule, Permissions, Options, Payments, and Appointments.
- The Services tab edits the barber-to-service assignment, and the Schedule tab owns recurring workdays plus days on/off.
- The target Team surface keeps Profile, Services, and Schedule. It removes login identity, private contact/employment fields, notifications, permissions, payroll/payments, days on/off, future schedules, and appointment history from the Provider form. Solo retains the default Provider in data but can hide this destination.

## Appointments and Confirmation Review

- `sources/js/app/main/appointments/appointmentsWrapper.jsx` and `appointmentNavigator.jsx` provide Add Appointment, view selection, provider/status filters, date navigation, and search.
- `sources/js/app/main/appointments/views/sideBySide/sideBySideView.jsx` renders a provider-by-provider day calendar. This is the strongest legacy signal for the returning merchant home.
- Clicking an item opens `AppointmentForm` in a modal. The legacy form can edit Provider, Services, Customer, recurrence, duration, time, notes, payment-related data, and notifications.
- `appointmentForm/confirmationScreen/confirmationScreen.jsx` explicitly reviews changes, refunds or additional charges, provider transfer, notifications, and recurring updates before save.
- The target first slice retains the day-calendar context and detailed Appointment snapshot inspection. It deliberately excludes manual booking, rescheduling, recurrence, block time, refunds/additional charges, notification controls, and Sale Order behavior until later slices settle those mutations.

## Prototype Consequence

- Variant A reduces the legacy mega-forms into an ordered Booking Readiness setup path.
- Variant B is the source-faithful reduction: Appointments is the default, the nav follows the legacy operational order, Services retains Details → Providers, Providers retains Profile/Services/Schedule tabs, and Availability focuses the legacy schedules on recurring Provider rules.
- Variant C decomposes the same legacy screens and arranges each retained input by the customer journey it affects.

The prototype must therefore be judged on two questions: whether Appointments should remain the returning merchant home, and whether setup should be a separate guided mode or remain discoverable through stable operational routes.
