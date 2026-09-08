# Account preferences

Owns identity-keyed locale and IANA timezone preferences. Derive the user ID from the session; routes and workers must use this service for writes.

- Null means unset. Rendering uses shared i18n defaults, English for locale and UTC for timezone, without replacing nullable storage.
- `initializeTimeZone` writes only if storage is still null. Preserve this conditional update in both adapters so browser initialization cannot overwrite a user's choice.
- Invalid timezone input fails `AccountPreferencesRejected`; it must not silently become the default.
- Writes audit changes and reread the row before returning. Preserve the existing `auth.user_updated` event.
