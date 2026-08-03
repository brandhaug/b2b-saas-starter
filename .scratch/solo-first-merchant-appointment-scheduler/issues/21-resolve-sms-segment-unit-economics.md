# Resolve the €0.03 SMS Segment Unit Economics

Type: grilling
Status: resolved
Blocked by: 10

## Question

Given that BeeSolo's settled Merchant charge is €0.03 per provider-accepted Outbound SMS Segment while SMSO.ro's current public low-volume Romania cost begins at €0.035 per 160-character message excluding VAT, should BeeSolo change the Merchant pricing and charging unit, require a written qualified route below €0.03 with an explicit margin floor, or omit production SMS at launch; and how should that decision reconcile the scheduler map with the Operational Messaging Router's later €0.045-per-delivered-intent Rate Card?

## Comments

### Resolution — 2026-07-30

BeeSolo supersedes the scheduler's €0.03-per-provider-accepted-Outbound-SMS-Segment Merchant charge with the Operational Messaging Router's **Messaging Rate Card**: **€0.045 excluding VAT for one verified Chargeable Delivery**, identical whether WhatsApp or SMS delivers the transactional Operational Notification. A Notification Intent snapshots its effective-dated Rate Card, reserves that one charge before provider submission, and may create at most one ordinary Merchant charge. Acceptance, retries, failed attempts, fallback, additional provider deliveries, and SMS segment counts never create another Merchant charge.

An **Outbound SMS Segment** remains a provider-cost unit and evidence fact, not a Merchant charging unit. BeeSolo records provider-native cost and realized margin separately and absorbs failed-attempt, fallback, duplicate-provider, and additional-segment costs. This removes the nonviable requirement to qualify an all-in route below €0.03 per segment and avoids coupling a stable Merchant price to mutable provider billing mechanics.

Production SMS remains part of launch only through the already-settled conjunctive **Messaging Launch Gate**. The qualified route must have written commercial and technical terms, pass capped live qualification, preserve the one-GSM-7-segment controlled-template constraint, and keep expected blended Provider Messaging Cost at or below **€0.036 per Chargeable Delivery**, 80% of the €0.045 net Merchant charge. Crossing €0.036 warns Operations; reaching €0.045 is critical and blocks launch or further rollout/configuration changes. These thresholds do not automatically reprice the Rate Card or silently disable already-authorized notifications after launch; containment follows the router's settled incident and kill-switch rules.

The scheduler's **SMS Balance** language is likewise superseded by the provider-neutral **Messaging Balance**. Launch top-ups remain €10, €25, or €50 of net service credit plus applicable VAT, but automatic top-up is outside launch scope. Charging occurs only on verified delivery rather than provider acceptance. Insufficient balance terminates the Notification Intent before provider submission without blocking the originating appointment change or independent email.

This decision reconciles rather than duplicates the Operational Messaging Router. Its provider-neutral Notifications boundary, Rate Card, balance ledger, implementation, verification matrix, route-provisioning work, and Messaging Launch Gate are authoritative. The scheduler specification must reference those decisions and must not introduce a parallel SMS-specific price, balance, charging lifecycle, or provider qualification rule.

No fog graduates and no new ticket is required. Existing Operational Messaging Router tickets already own production route qualification, fiscal readiness, top-up delivery, and final launch proof.
