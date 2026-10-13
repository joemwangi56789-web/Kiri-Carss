# Kiri Cars saved-search alerts — setup notes

This feature is being introduced behind a separate branch. It is not live until the pull request is reviewed, merged, deployed, and the required services are configured.

## Required setup before sending real notifications

1. Install Firebase CLI and run `firebase login`.
2. From the repository root, run `cd functions && npm install`.
3. Confirm Firebase project `kiri-cars` is selected before deploying.
4. Firebase Cloud Functions and scheduled tasks require the Firebase Blaze (pay-as-you-go) plan. Set billing budgets and alerts before deployment; budget alerts do not cap spend.
5. Configure secrets using `firebase functions:secrets:set RESEND_API_KEY`, `firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN`, and `firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID`.
6. Configure `KIRI_EMAIL_FROM` to an address verified with Resend and `KIRI_SITE_URL` to the real public site URL. The default domain is only a placeholder until kiricars.co.ke is live and verified.
7. Create and approve WhatsApp Business message templates, then configure `KIRI_WHATSAPP_VERIFY_TEMPLATE`, `KIRI_WHATSAPP_ALERT_TEMPLATE`, and optionally `KIRI_WHATSAPP_TEMPLATE_LANGUAGE` (default `en`). The verification template must accept two body parameters (code and management link). The alert template must accept two body parameters (vehicle summaries and listing link). Template names and placeholder counts must match Meta's approved templates.
8. Deploy Firestore rules and functions only after reviewing the changes with `firebase deploy --only firestore:rules,functions`.

## Current limitations that must be resolved before launch

- The email/WhatsApp providers have not been connected or tested from this repository.
- The weekly email worker needs a real, working unsubscribe mechanism before marketing is enabled.
- Guest inactivity reminders and management actions need an end-to-end test. A secure confirmation flow for the 14-day inactivity reminder must be completed before treating reminders as production-ready.
- WhatsApp Cloud API requires the right Meta business setup, approved templates, consent, and provider policy compliance.
- Firebase Functions costs money on Blaze beyond applicable no-cost allowances. Monitor usage; budget alerts alone do not stop billing.
- Run end-to-end tests for token expiry, verification attempt limits, queue retries, listing status changes, duplicate suppression, account transfer, and data deletion before merging to production.
