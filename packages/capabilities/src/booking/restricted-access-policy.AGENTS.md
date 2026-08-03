# Appointment Restricted Access Policy

`restricted-access-policy.ts` owns the Appointment-specific classification for
Restricted Access exceptions. Only commands operating on an existing Appointment
commitment may be classified as safe; creation and unrelated mutation kinds remain
denied. The shared foundation consumes the resulting boolean decision without
knowing Booking terminology.
