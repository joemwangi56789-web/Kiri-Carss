# Kiri Cars saved-search alerts — setup notes

This feature is being introduced behind a separate branch. It is not live until the pull request is reviewed, merged, deployed, and the required services are configured.

## Required setup before sending real notifications

1. Install Firebase CLI and run `firebase login`.
2. From the repository root, run `cd functions && npm install`.
3. Confirm Firebase project `kiri-cars` is selected before deploying.
4. Firebase Cloud Functions and scheduled tasks require the Firebase Blaze (pay-as-you-go) plan. Set billing budgets and alerts before deployment; budget alerts do not cap spend.
5. Configure secrets using `firebase functions:secrets:set RESEND_API_KEY`, `firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN`, and `firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID`.
6. Copy `functions/.env.example` to `functions/.env.kiri-cars` and set `KIRI_SITE_URL` to the actual live website URL, plus `KIRI_EMAIL_FROM` to a sender address verified with Resend. Never commit `.env.kiri-cars`; it is ignored by Git.
7. Create and approve WhatsApp Business message templates, then configure `KIRI_WHATSAPP_VERIFY_TEMPLATE`, `KIRI_WHATSAPP_ALERT_TEMPLATE`, `KIRI_WHATSAPP_INACTIVITY_TEMPLATE`, and optionally `KIRI_WHATSAPP_TEMPLATE_LANGUAGE` (default `en`). The verification template needs two body parameters (code and management link); the alert template needs two (vehicle summary and listing link); the inactivity template needs one (confirmation link). Names and placeholder counts must match Meta's approved templates.
8. The saved-search UI uses Firebase Functions in `us-central1`. Deploy Firestore rules and functions only after reviewing the changes with `firebase deploy --only firestore:rules,functions`.

## Current limitations that must be resolved before launch

- The email/WhatsApp providers have not been connected or tested from this repository.
- Weekly promotional emails include an unsubscribe link that withdraws promotional consent across saved searches for that email address. Test the unsubscribe flow before enabling campaigns.
- Guest inactivity reminders use a 14-day confirmation link and automatically pause unconfirmed searches. Test this flow end-to-end before production.
- The one-minute scheduled alert worker polls after the 60-second grouping window, so actual dispatch may take longer than 60 seconds. Measure this in testing; a task-queue scheduler would be needed for tighter timing.
- WhatsApp Cloud API requires the right Meta business setup, approved templates, consent, and provider policy compliance.
- Firebase Functions costs money on Blaze beyond applicable no-cost allowances. Monitor usage; budget alerts alone do not stop billing.
- Run end-to-end tests for token expiry, verification attempt limits, queue retries, listing status changes, duplicate suppression, account transfer, and data deletion before merging to production.
