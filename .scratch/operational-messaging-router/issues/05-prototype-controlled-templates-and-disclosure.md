# Prototype Controlled Templates and Booking Disclosure

Type: prototype
Status: resolved
Blocked by: 01, 02, 03, 04

## Question

Which concrete Romanian and English platform-owned templates, controlled variables, formatting and segment constraints, Merchant identification, confirmation-only secure link, booking-flow disclosure, quiet-hour copy, suppression copy, and provider approval workflow make confirmation, one reminder, cancellation, and reschedule messages understandable, compliant, low-cost, and safe to render from immutable Appointment facts?

## Comments

### Prototype ready for review — 2026-07-27

The throwaway review artifact was removed after approval; the durable decision is recorded in the resolution below.

The throwaway Booking App surface compares three WhatsApp permission interactions on one route: an inline affirmative checkbox, stepped expectation-setting, and reuse of the existing Booking policy popup. All now share the selected single-segment ASCII SMS policy. The surface exposes Romanian/English confirmation, reminder, cancellation, and reschedule messages; WhatsApp/SMS previews; live GSM-7 unit counts; immutable controlled-field limits; reminder windows; suppression behavior; and the eight-template Meta approval workflow.

The ticket remains claimed because a prototype is HITL. Resolution requires the platform owner to choose or combine the disclosure placement, SMS language-versus-cost policy, and reminder window, and to approve or revise the proposed message bodies and workflow.

### Review feedback — 2026-07-27

The platform owner identified the existing cancellation-policy popup as the right interaction family. Variant C now reuses that established Booking policy-sheet pattern and the already-present optional notification decision shape. WhatsApp permission remains a separate **Yes, on WhatsApp / Skip** decision rather than being bundled into the cancellation policy's required **OK**, preserving explicit channel permission and allowing Skip to make WhatsApp ineligible while the disclosed SMS fallback remains available.

### Character-limit research checkpoint — 2026-07-27

The prototype now separates provider ceilings, billing boundaries, and product limits. Meta's documented template-body ceiling is 1,024 characters, while body-only template text parameters can total 32,768; the proposed rendered WhatsApp product envelope is a deliberately smaller 500 characters. SMS segment billing changes at 160/153 GSM-7 septets or 70/67 UCS-2 units. SMSO documents the required `body` and optional diacritic-removal behavior but publishes no hard body or concatenation maximum, so that ceiling remains a written provider question and real-route qualification case rather than a code assumption.

### SMS length decision — 2026-07-27

The platform owner selected a single-segment launch constraint for every SMS fallback. Romanian and English SMS templates must render to GSM-7 and at most 160 septets at the maximum permitted controlled-field lengths; multipart SMS is rejected before balance reservation rather than submitted or silently truncated. Romanian SMS uses deterministic ASCII transliteration while WhatsApp preserves diacritics. The SMS-specific immutable snapshot fields are a Merchant SMS label (maximum 24 ASCII characters), `DD.MM.YYYY` date, `HH:mm` time, location SMS label (maximum 28 ASCII characters), reference (maximum 12), and platform short Confirmation URL (maximum 31). Only confirmation includes that URL.

### Permission-model correction — 2026-07-27

The platform owner corrected the prototype's channel-specific assumption. The existing **Get appointment updates by text** step already collects the mobile number and an affirmative **Yes** for subsequent transactional confirmation, reminder, reschedule, and cancellation messages. Meta's quoted policy requires those two facts; it does not require the customer copy to name WhatsApp, explain channel order, or disclose SMS fallback. The selected interaction therefore reuses that transactional text step without adding a WhatsApp prompt. WhatsApp-first and SMS-fallback selection remain internal routing behavior. Transactional email remains the existing second operational step, while marketing SMS and marketing email remain separate later permissions and cannot alter transactional permission.

### Resolution — 2026-07-27

The Booking App reuses its existing **Get appointment updates by text** policy sheet. A customer supplies a mobile number and affirmatively selects **Yes** to grant **Operational Messaging Permission** for subsequent confirmation, reminder, reschedule, and cancellation messages. The copy remains provider-agnostic: it does not name WhatsApp, describe fallback, or offer a channel choice. **Skip** withholds mobile Operational Notifications. Transactional email remains its existing separate permission step. Marketing SMS and marketing email remain separate later prompts and neither grant nor revoke Operational Messaging Permission.

The platform owns four Romanian and four English WhatsApp Utility templates: confirmation, reminder, cancellation, and reschedule. Every rendered body starts from immutable Appointment facts, identifies the Merchant while truthfully using the beesolo platform sender, contains no promotional language, and excludes customer name, service or Provider name, free-text notes, price, and payment facts. Controlled WhatsApp fields are Merchant label (maximum 40), localized date (maximum 32), `HH:mm` time, location label (maximum 64), reference (maximum 12), and the platform-generated secure Confirmation URL. The rendered WhatsApp body is rejected above the approved 500-character product envelope. Only confirmation contains the secure Confirmation URL; reminder, cancellation, and reschedule contain no URL.

Every Romanian and English SMS fallback is a separately controlled GSM-7 template bounded to one segment. Romanian SMS facts and labels use deterministic ASCII transliteration while WhatsApp preserves diacritics. SMS fields are Merchant SMS label (maximum 24 ASCII), date exactly `DD.MM.YYYY`, time exactly `HH:mm`, location SMS label (maximum 28 ASCII), reference (maximum 12), and platform short Confirmation URL (maximum 31). The fully rendered SMS must contain only GSM-7 characters and total at most 160 septets at maximum field lengths; otherwise the intent is rejected before balance reservation and is never truncated or submitted as multipart. The approved worst-case template budget peaks at 155 septets.

Reminder delivery uses **08:00–20:00 in the Shop timezone**. A reminder due outside that interval waits until the next opening only if it remains useful before the Appointment. Confirmation, cancellation, and reschedule messages are immediate. The fixed help/stop wording directs the customer to the Merchant or beesolo support without making inbound WhatsApp or SMS a launch feature. A withdrawal creates the applicable Suppression Directive; a later booking does not silently restore permission.

Template publication is versioned and gated. Each locale-purpose pair freezes its ordered variable schema and representative examples, passes required-field, maximum-length, URL-only-in-confirmation, non-promotional-language, rendered-body, GSM-7, and segment checks, then receives product/privacy review, Romanian-language review, and the planned legal checkpoint before Meta submission as Utility. The system records provider template name/id, locale, requested and observed category, content version, status, and approval evidence. Sends require the exact approved/enabled version; rejection, disablement, mismatch, or unexpected recategorization stops WhatsApp submission and follows the settled kill-switch and eligible-fallback lifecycle.

The platform owner approved the prototype and may revise controlled template copy through a later version without reopening this interaction decision, provided every invariant above continues to hold.
