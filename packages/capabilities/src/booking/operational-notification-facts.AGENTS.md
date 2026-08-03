# Booking Operational Notification Facts

This module translates immutable Appointment snapshots into the controlled,
provider-neutral facts accepted by Notifications.

- Do not render message bodies or choose routes here.
- Keep references short and non-secret. Only confirmation may supply a URL.
- Use the Appointment's snapshotted time zone and current versioned facts; never
  re-read mutable Catalog presentation while preparing a consequence.
