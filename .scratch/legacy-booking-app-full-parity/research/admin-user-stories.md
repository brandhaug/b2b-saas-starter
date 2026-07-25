# Legacy admin user stories

## Scope and method

This report describes the legacy admin surface rooted at `apps/app/sources/js/app/admin`. It uses source code only, including route-linked components and services outside that folder where necessary. Paths below are relative to `/Users/hassan/Desktop/ssqu/recreate/apps/app/sources/js` unless stated otherwise.

The source proves what the frontend exposes and which requests it makes. It does **not** prove server-side authorization, database effects, or production feature-flag values. Those uncertainties are called out explicitly.

## Executive summary

The admin application is an operations console for managing brands, shops, users, customers, subscriptions, migration/import work, and commission/tip payout readiness. Its highest-impact capabilities include impersonating users, invalidating sessions, changing account ownership, editing payment account identifiers, creating and refunding subscription charges, merging or privacy-deleting customers, wiping imported/all customer data, and configuring white-label apps.

The `/admin` route admits three user kinds: super admin, regular admin, and agent. There are no child-route guards differentiating those roles. Instead, the UI applies partial component-level controls: only super admins see admin/agent role choices, and a regular admin without `admin:modify` is treated as read-only by shared admin action buttons. Agents are not included in that read-only selector. Backend authorization is therefore essential for every sensitive request.

## Access, navigation, and global behavior

- As an admin-family user, I can enter `/admin`; super admin, regular admin, and agent all pass the same route guard. A mismatched role is redirected to `/` while the intended path/query are preserved (`app/admin/routes.jsx:65-66`; `app/auth/routerHooks.js:181-195`).
- As an admin-family user, I see six unconditional primary navigation items: Brands, Shops, Users, Clients, Commission/Tip Splits, and Subscription Plans (`app/admin/adminApp.jsx:60-103`).
- As an admin, I am redirected from `/admin` to `/admin/users` by default (`app/admin/routes.jsx:65-67`).
- As an admin, I receive realtime operational notifications from PubNub channel `admin_user_<current-user-id>`; notification type, message, and severity are rendered in the UI (`app/admin/adminApp.jsx:21-55`).

The complete child-route map is centralized under the one guard: shops at `app/admin/routes.jsx:68-90`, users at `:91-98`, customers at `:99-102`, commission splits at `:103`, subscription plans at `:104-108`, and brands at `:109-123`.

## Brands

### Browse and lifecycle

- As an admin, I can search, sort, page through, and open brands. The list shows name, website, Instagram, shop count, creation date, and an edit action (`modules/admin/brands/brand-list/brand-list.tsx:5-7`; `modules/admin/brands/brand-list/table/columns.tsx:7-32`). Data comes from `GET /v1/brand` (`modules/admin/brands/network/brands-query.ts:28-46`).
- As an admin, I can create a brand with `POST /brand`, optionally upload a custom kiosk logo, and refetch the created brand with shops/extensions/settings (`app/admin/brands/actions.js:38-76`).
- As an admin, I can edit a brand with `PUT /brand/:id`. Saving can additionally upload extension images, Google configuration files, an Apple configuration key, and a custom kiosk logo (`app/admin/brands/actions.js:93-204`).
- As an admin, I can delete a brand only when its form has no attached shops; the UI suppresses the delete control when `brandShops.length > 0` (`app/admin/brands/components/BrandForm.jsx:111-120`). The request is `DELETE /brand/:id` (`app/admin/brands/actions.js:79-82`).
- As an admin, I can reorder/view the brand's shops and navigate among main settings, subscription, and import tabs (`app/admin/brands/components/BrandForm.jsx:457-465`; `app/admin/brands/components/BrandLayout.jsx:8-30`).

### Brand configuration

The brand form supports these user stories:

- Maintain identity and localization: name, description, email, website, Instagram, currency, supported languages, default language, SMS originator, and SMS verification (`app/admin/brands/components/BrandForm.jsx:161-214`).
- Configure platform capabilities: ecommerce sync, Mailchimp, rewards, staff management and primary account owner, visibility of brand customers to shops/barbers, notification-consent override, financing/loans, API readers, gift-card receipt behavior, memberships, kiosk itemized charges, reservation ads, and instant payouts (`app/admin/brands/components/BrandForm.jsx:216-355`).
- Configure analytics and appointment economics: Google Analytics measurement credentials, Meta pixel ID, appointment-fee enablement, fee amount, and SQUIRE/customer fee split (`app/admin/brands/components/BrandForm.jsx:356-456`).
- Configure the public brand page with logo, background, display name, and route (`app/admin/brands/components/BrandPageForm.jsx:9-25`).
- Upload, change, and preview a kiosk logo, but only while the custom-logo toggle is enabled (`app/admin/brands/components/KioskLogoControls.jsx:20-50,62-69`).
- Configure a white-label mobile app: store metadata, app identity/descriptions, icons/artwork/colors, Apple identifiers/territories/API key, Android application/client IDs and Firebase/service-account files, third-party Facebook/Branch/Payworks settings, update controls, and legacy scheme/passphrase/login options (`app/admin/brands/components/CustomAppForm.jsx:18-469`). App Store/Play versions and account-status fields are display-only (`:275-302,329-378`).

### Brand subscription and imports

- As an admin, I can see the active plan, status, billing email, base price, discount, and total (`app/admin/subscriptions/components/SubscriptionDetails.jsx:8-35`).
- As an admin, I can directly toggle brand feature entitlements such as Engage, commission/product/custom reporting, chat, conversion tracking, and (for indie brands) Engage enablement (`app/admin/brands/components/BrandSubscriptionOptions.jsx:9-60`).
- As an admin, I can import customers, gift cards, products, and services for a brand, and delete the imported sets. I can also launch a full customer wipe job and update customer-reminder settings (`app/admin/brands/actions.js:207-234`; route tabs at `app/admin/brands/import/Layout/Layout.jsx:7-50`).

## Shops

### Browse, create, and edit

- As an admin, I can search and sort shops, switch between enabled and disabled tabs, and see name, connected-bank-account presence, email, city, country, shop type, barber count, creation date, and edit action (`modules/admin/shops/shop-list/shop-list.tsx:7-9`; `modules/admin/shops/shop-list/shop-tabs.tsx:4-6`; `modules/admin/shops/shop-list/table/columns.tsx:9-46`). The modern list calls `GET /v1/shop` (`modules/admin/shops/network/shops-query.ts:28-52`).
- As an admin, I can create a shop with `POST /shop`, optionally upload its avatar, and refetch full details (`app/admin/shops/actions.js:76-101`).
- As an admin, I can edit a shop through the shared shop form; the admin wrapper updates and refetches it (`app/admin/shops/components/editShop.jsx:9-31`; `app/admin/shops/actions.js:56-60`). No hard-delete shop action exists in this admin module; enabled/disabled status appears to be the visible lifecycle control.
- As an admin, I can navigate a shop's main settings, payment, import, subscription, loan, and hourly-wage tabs, with barber-specific payment/subscription drill-downs (`app/admin/shops/components/ShopLayout.jsx:9-60`).

### Shop configuration

The shared form exposes a very broad settings surface. Admin stories include:

- Enable/disable a shop and set fraud verification status; associate a brand; manage name, alias, contact/social data, timezone/date format, media, shop type, currency, payment-reader location, description, address, languages, schedules, days off, and notification/reminder settings (`app/main/shops/ShopForm.jsx:355-605`; saved field inventory at `app/main/shops/shopFormFields.js:1-139`).
- Configure booking and operational options including adult-only, any-barber booking, group appointments, reviews, waiting list, rewards, kiosk, cash drawer, booking codes, waivers, QuickBooks, memberships, API readers, deposits, reporting, POS/readers, tipping, split payments, no-show charging, walk-in-only, gift cards, time tracking, permission passcodes, payroll, commission splits, fees, and BNPL/Afterpay (`app/main/shops/ShopForm.jsx:604-920`; `app/main/shops/shopFormFields.js:21-139`).
- Saving may require confirmation when overriding barber settings or changing commission-split behavior; invalid schedules reject the save. Payment-deposit fields are mapped or removed according to a shop feature flag (`app/main/shops/ShopForm.jsx:200-327`).
- Feature flags alter visible/serialized capabilities, including auto-payout defaults, group appointments, client reviews, and payment deposits (`app/admin/shops/components/addShop.jsx:10-38`; `app/main/shops/shopFormContainer.js:193-201`).

### Payment accounts, subscriptions, loans, and wages

- As an admin, I can set a shop's or individual barber's `managedAccountId`; the UI lists barbers for drill-down and saves through `POST /shop/:id/connected-account` or `POST /barber/:id/connected-account` (`app/admin/shops/components/PaymentSettings.jsx:10-49`; `app/admin/shops/actions.js:207-211`).
- As an admin, I can inspect each barber's subscription and disable/cancel an enabled subscription (`app/admin/shops/components/BarberSubscriptions.jsx:12-53`).
- As an admin, I can create or update a shop loan with borrowed amount, repayment percentage, and start date; amount owed is read-only, and the UI shows loan-history status/logs (`app/admin/shops/components/Loan.jsx:12-109`; APIs at `app/admin/shops/actions.js:147-175`).
- As an admin, I can enable and configure hourly-wage calculation: minimum wage, overtime commission thresholds/hours, regular and weekly hours, consecutive-day rules, location/shop identifiers and type, ADP report, and shop code (`app/admin/shops/components/HourlyWageRules.jsx:13-164`). Rules use `GET` and `POST /shop/:id/hourly-wage-rules` (`app/admin/shops/actions.js:185-199`).

### Data migration and imports

- As an admin, I can preview the first 100 rows of a CSV before submitting it; imports are disabled while busy or until a preview/file exists (`app/admin/shops/import/Shared/SharedContainer.js:11-57`).
- As an admin, I can import customers, optionally for one barber; delete previously imported customers; or trigger a destructive wipe of **all** shop customers (`app/admin/shops/import/Customers/CustomersImport.jsx:13-70`). The endpoints are `POST /shop/:id/import-customers[?barberId=...]`, `DELETE /shop/:id/delete-customers`, and `POST /jobs/wipe-customers` (`app/admin/shops/actions.js:115-127`).
- As an admin, I can import and wipe imported appointments, products, services, and gift cards (`app/admin/shops/import/Appointments/AppointmentsImport.jsx:23-69`; `Products/ProductsImport.jsx:21-59`; `Services/ServicesImport.jsx:20-58`; `GiftCards/GiftCardsImport.jsx:10-44`; APIs at `app/admin/shops/actions.js:129-145,201-205`).
- As an admin, I can submit one or more external review URLs for scraping; submission is disabled with no URLs or while active (`app/admin/shops/import/Reviews/ReviewsImport.tsx:17-22`). It calls `POST /reviews/scrape` for the shop (`app/admin/shops/actions.js:138-143`).
- As an admin, I can run an external-platform customer import using a platform token and optional barber mapping. Although the route is generically named “auto import,” its mutation hard-codes `type: 'customers'` and fixed reminder defaults (`modules/admin/shops/import/external-platforms-import/components/import-form.tsx:17-20`; `network/import-platform-data-mutation.ts:25-42`).

## Users and access administration

### Find and inspect users

- As an admin, I can search shops, expand a shop to see its users, and inspect username, user type, name, and actions; I can switch to a legacy full list with “Show all” (`app/admin/routes.jsx:52-63`; `modules/admin/users/list/shop-list.tsx:8-10`; `modules/admin/users/list/columns.tsx:37-60`).
- As an admin, I can list regular-admin and agent accounts with their permissions and enabled state, page the list, and open them for editing (`app/admin/users/components/AdminUsers/AdminUsersList.jsx:10-59`; request filter at `app/admin/users/actions.js:208-216`).
- Fetching one user includes barber/shop/brand relationships and permissions (`app/admin/users/actions.js:41-51`).

### Create and edit users

- As an admin, I can create brand, shop, or barber users. As a **super admin**, I can additionally create/edit regular-admin and agent kinds because those role controls are super-admin-only (`app/admin/users/components/Shared/userForm.jsx:259-333`; `app/auth/roleAware.jsx:86-88`).
- As an admin, I can enable/disable an account, change username/password, associate shops/brand/barbers, assign admin permissions, set account owner and owner name, enable time tracking, require a permission passcode, and configure shop/brand permissions (`app/admin/users/components/Shared/userForm.jsx:173-405`).
- Form constraints require a shop user to have shop assignments, a brand user to have a brand, and a barber user to have a barber; shop and brand association are mutually exclusive (`app/admin/users/components/Shared/userForm.jsx:38-101`).
- Creating a user calls `POST /user` with `isTmpPassword: true`; the generated temporary password is retained for display after success (`app/admin/users/actions.js:160-191`; `app/admin/users/components/AddUser/AddUserContainer.js:31-47`).
- Updating calls `PUT /user/:id`. If the server returns confirmation-required, the UI asks whether to make the user account owner and retries with `setAccountOwner=yes|no` (`app/admin/users/actions.js:98-121`).
- As an admin, I can select per-kind permissions loaded from `GET /user/permissions/:kind` (`app/admin/users/actions.js:218-224`; `app/admin/users/components/Shared/userPermissions.jsx:13-46`).
- Two-factor phone/email are displayed as disabled fields. The opt-in toggle is feature-flagged and disabled if the user was not already opted in, so this form cannot newly opt an unopted user into 2FA (`app/admin/users/components/Shared/userForm.jsx:225-258`).

### Sessions, impersonation, and deletion

- As an admin, I can impersonate connected non-admin/non-agent users. The control hides for disconnected users and can block kiosk users in guarded contexts (`app/admin/users/components/Shared/userForm.jsx:166-191`; `app/admin/shared/ImpersonateUser/ImpersonateUserContainer.js:11-44`).
- As an admin, I can force-log-out all sessions for a connected user after confirmation; this is implemented as `PUT /user/:id` with `{invalidateToken: true}` (`app/admin/shared/LogoutUserSessions/LogoutUserSessionsContainer.js:10-39`).
- As an admin, I can delete a user after confirmation. If the server detects ownership implications, it may require a second confirmation before deletion (`app/admin/users/components/EditUser/EditUserContainer.js:67-86`; `app/admin/users/actions.js:124-144`).
- As an admin, I can privacy-delete a customer user through `DELETE /user/:id/privacy-delete` from the customer screen (`app/admin/users/actions.js:146-149`).

## Customers

- As an admin, I can search customers by username, name, phone, or email using Typesense and open the selected customer (`app/admin/customers/Customers.jsx:7-14`; `app/main/search/actions.js:235-253`; result URL at `app/main/search/globalSearchBox.jsx:276`).
- As an admin, I can view first/last name, email, phone, username, associated shops, and appointment counts/details (`app/admin/customers/components/CustomerDetails.jsx:9-68`).
- As an admin, I can edit **only the username** on this screen; no other customer identity field is submitted (`app/admin/customers/containers/Customer.js:19-49`).
- As an admin, I can normally delete or GDPR/privacy-delete the customer user, both after destructive confirmation (`app/admin/customers/containers/Customer.js:50-69`).
- As an admin, I can compare suspected duplicates, choose which record survives, and merge them with `POST /customer/merge`. The merge preserves a regular email-style login when the chosen survivor lacks one (`app/admin/customers/components/AdminCustomerDuplicateForm.jsx:10-64`; `app/admin/customers/containers/AdminCustomerDuplicateForm.js:28-50`; `app/admin/customers/actions.js:3-6`).

## Subscriptions and billing

### Plans

- As an admin, I can view plan name, active subscription count, and prices in USD, CAD, GBP, AUD, and EUR (`app/admin/subscriptionPlans/components/SubscriptionPlans.jsx:21-69`).
- As an admin with write access, I can create, edit, and delete subscription plans via `GET/POST/PUT/DELETE /subscription/plan` (`app/admin/subscriptionPlans/actions.js:4-19`).
- Plan feature flags include extra features, custom app, Engage/campaigns, commission/product/custom reporting, chat, and conversion tracking (`app/admin/subscriptionPlans/components/SubscriptionPlanForm.jsx:12-87`).
- A plan with active subscriptions cannot be deleted in the UI (`app/admin/subscriptionPlans/components/SubscriptionPlanForm.jsx:88-106`).

### Brand and barber subscriptions

- As an admin, I can add or update a brand subscription, choose its plan, activate/deactivate it, set per-location price and quantity, and manage a custom indie-app add-on (`app/admin/subscriptions/components/SubscriptionForm.jsx:91-165`; `app/admin/subscriptions/containers/SubscriptionContainer.js:47-66`; APIs at `app/admin/subscriptions/actions.js:9-29`). Barber subscriptions are a separate update-only flow described under Shops.
- When `brand-subscription-features-toggle` is enabled, I can add allowed, available subscription features after a price/trial confirmation. Active and available features are loaded from dedicated endpoints; apply/cancel use `/subscriptions/:id/features...` (`app/admin/subscriptions/components/SubscriptionForm.jsx:33-89,142-160`; `app/admin/subscriptions/actions.js:31-53`).
- The indie custom-app add-on is disabled for an existing subscription unless already active (`app/admin/subscriptions/containers/SubscriptionForm.js:65-70`).

### Charges and invoices

- As an admin, I can view one-time charges, create a charge with description and price, and issue a full or custom refund while the charge has an unrefunded balance (`app/admin/subscriptions/components/SubscriptionChargeForm.jsx:12-41`; `SubscriptionCharges.jsx:13-105`). APIs list/create/refund charges (`app/admin/subscriptions/actions.js:56-85`).
- As an admin, I can view invoice amount, status, refunded amount, and charge time. Allowed actions depend on state: paid invoices with positive total can be refunded; draft/open invoices can be paid or marked uncollectible; uncollectible invoices can be paid; void/refunded invoices have no actions (`app/admin/subscriptions/components/SubscriptionInvoices.jsx:14-71,74-179`). The requests are listed at `app/admin/subscriptions/actions.js:87-130`.

## Commission and tip split readiness

- As an admin, I can view separate Commission Splits and Tip Splits tabs (`app/admin/splitsReport/components/CommissionSplitsList.jsx:11-24`).
- For every relevant shop, opening the report triggers payout review plus last-payout-date requests, and separately a daily-payroll report request (`app/admin/splitsReport/actions.js:4-29`; trigger logic at `app/admin/splitsReport/SplitsReportContainer.js:14-27`).
- The underlying report APIs are `POST /shop/:id/review-payout`, `GET /shop/:id/payout`, and `GET /shop/:id/last-daily-payroll` (`app/main/reports/actions.js:278-319`). Errors stop loading but are returned rather than surfaced/rethrown by the aggregate action (`app/admin/splitsReport/actions.js:9-29`).

## Permissions, guards, and read-only behavior

- `USER_TYPES` distinguishes customer `0`, barber `1`, shop `2`, super admin `3`, regular admin `4`, agent `5`, and brand `6` (`app/auth/constants.js:8-25`).
- The only route boundary permits super admin, regular admin, and agent. No descendant route has a separate guard (`app/admin/routes.jsx:65-124`; `app/auth/routerHooks.js:181-195`).
- Regular admin is considered read-only when it lacks permission object `admin`, operation `modify` (`app/auth/selectors.js:220-230`).
- Shared Admin Add/Save/Delete/GDPR/Action buttons merge that read-only result into `disabled`, covering many writes (`app/admin/shared/Buttons/AdminActionButton.jsx:7-24`; `AdminAddButton.js:1-8`; `AdminSaveButton.js:1-8`; `AdminDeleteButton.js:1-8`; `AdminGDPRDeleteButton.js:1-8`). Subscription-plan creation additionally applies a disabled CSS/link state (`app/admin/subscriptionPlans/components/SubscriptionPlans.jsx:21-31`).
- Only super admins see the regular-admin and agent role radio controls (`app/admin/users/components/Shared/userForm.jsx:301-330`; `app/auth/roleAware.jsx:86-88`).

## Important limitations and uncertainties

1. **Frontend access is broad.** All admin-family roles can route to every admin area and see all six nav items. Component controls provide only partial differentiation. The source reviewed does not prove backend endpoint authorization.
2. **Read-only is narrowly defined.** The selector applies only to regular admins lacking `admin:modify`; agents are not classified read-only. Shared buttons protect many writes, but not necessarily every raw button, link, form, or programmatic handler.
3. **High-impact operations rely on the server.** Impersonation, ownership changes, session invalidation, privacy deletion, merges, imports/wipes, refunds, payment-account edits, subscription actions, and loan changes all require backend validation beyond the visible UI.
4. **No shop hard-delete story was found** in the admin action module. Shops can be created, edited, and browsed by enabled/disabled state.
5. **Auto-import is narrower than its name.** Its current request imports customers only, despite a generic external-platform UI and endpoint wrapper.
6. **Customer editing is intentionally narrow.** Only username is updated on the customer detail form; other identity/contact data are display-only there.
7. **Feature flags affect actual availability.** 2FA controls, appointment deposits, group appointments, client reviews, auto-payout behavior, and subscription features can be hidden, disabled, or omitted from requests at runtime.
8. **Several status fields are read-only.** Examples include loan amount owed, mobile-store version/status fields, and existing 2FA contact information.
9. **Imports are destructive and asynchronous in places.** “Delete imported” differs from full customer wipe; the latter launches `/jobs/wipe-customers`. The source does not establish job progress, reversibility, or audit behavior.

## Capability checklist

| Area          | View/search                              | Create/import                                                | Edit/configure                                                     | Delete/wipe/refund/trigger                                          |
| ------------- | ---------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Brands        | Search/list/details/shops                | Create; import customers, gift cards, products, services     | Identity, flags, page, kiosk, mobile app, billing/features         | Delete empty brand; delete imports; wipe customers                  |
| Shops         | Search; enabled/disabled; details        | Create; CSV/external imports                                 | Extensive booking, POS, payroll, fee, payment, loan, wage settings | Delete import sets; wipe customers; trigger review scrape           |
| Users         | Browse by shop; admin/agent list         | Create brand/shop/barber; super admin can create admin/agent | Enable, credentials, assignments, permissions, ownership           | Delete; invalidate sessions; impersonate                            |
| Customers     | Search and view shop/appointment history | —                                                            | Username only; select merge survivor                               | Normal delete; privacy delete; merge duplicates                     |
| Plans         | List prices and active counts            | Create plan                                                  | Edit name and feature entitlements                                 | Delete only with zero active subscriptions                          |
| Subscriptions | View plan/status/prices/charges/invoices | Add subscription/features/one-time charges                   | Activate, plan, quantity, price, add-ons                           | Cancel feature/subscription; refund; pay/mark invoice uncollectible |
| Reports       | Commission/tip readiness                 | —                                                            | —                                                                  | Trigger payout-review/daily-payroll fetches                         |
