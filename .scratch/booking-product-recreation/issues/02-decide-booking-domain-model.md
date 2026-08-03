# Decide Booking Domain Model

Type: grilling
Status: done
Blocked by: 01

## Question

What canonical domain model and bounded contexts should the target Booking Product use for the first Booking Vertical Slice, translating Legacy Source concepts into this repo's vocabulary?

Resolve terms such as Merchant, Brand, Shop, Location, Barber, Professional, Provider, Service, Add-on, Customer, Booking Session, Cart, Appointment, Sale Order, Availability, Payment Intent, and Confirmation. Update `CONTEXT.md` as terms are settled.

## Decision

The first Booking Vertical Slice originally proposed four bounded contexts: **Merchant Catalog**, **Scheduling**, **Booking**, and **Payments**. Issue 09 later narrowed checkout to a fixed **Pay In Person** fact with no payment behavior, so the implemented first-slice contexts are **Merchant Catalog**, **Scheduling**, and **Booking**. **Booking** consumes bookable configuration from **Merchant Catalog** and candidate times from **Scheduling**; **Payments** is reserved for a future **Pay Now** path.

Canonical Merchant Catalog terms are **Merchant**, **Brand**, **Shop**, **Shop Address**, **Provider**, and **Service**. "Location" is customer-facing copy for choosing a **Shop**. "Barber" and "Professional" are vertical-specific or customer-facing copy for **Provider**. "Add-on" is customer-facing copy for an **Additional Service**, not a separate first-slice entity.

The customer journey is modeled as **Booking Session** -> **Appointment** -> **Confirmation**. Legacy **Cart** translates to **Booking Session**. Legacy **Sale Order** translates to the checkout result and confirmation payload, not a canonical first-slice entity.

**Availability** is the set of candidate **Time Slots** for a selected public booking page, services, and provider choice. **Schedule Rules** are deferred merchant-side configuration that may produce availability later.

The booking flow uses **Provider Preference** with **Specific Provider** or **Any Provider**. **Any Provider** can later resolve to a concrete **Provider** while preserving that the customer booked through the any-provider path.

**Customer** means the person for whom an appointment is booked, with **Customer Details** captured during the booking session. Durable customer profiles, saved cards, notification consents, and marketing profile behavior are deferred.

**Checkout Path** distinguishes **Pay Now** from **Pay In Person** in the canonical language. Issue 09 later renamed the term from Checkout Choice because the first Booking Vertical Slice applies **Pay In Person** automatically; **Pay Now** and provider-specific **Payment Intent** behavior are deferred.

The glossary was updated in [`CONTEXT.md`](../../../CONTEXT.md), and the context split is recorded in ADR [`0050-booking-bounded-contexts.md`](../../../docs/adr/0050-booking-bounded-contexts.md).
