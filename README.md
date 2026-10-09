# Kiri Cars

Kiri Cars is a Kenyan vehicle marketplace built with HTML, CSS, JavaScript ES modules, Firebase Authentication, and Cloud Firestore.

**Repository:** https://github.com/joemwangi56789-web/Kiri-Carss

## Features currently in the code

- Public homepage with vehicle listings read from Firestore.
- Search and filters for manufacturer, car type, year, status, and minimum/maximum price.
- Vehicle cards showing available details and an optional image loaded from an image URL.
- WhatsApp enquiry messages prepared for the selected vehicle.
- Email/password login for owner and showroom administrators.
- Owner dashboard for creating administrator accounts, viewing administrator profiles, and counting listings.
- Admin dashboard for adding vehicles and viewing/deleting listings created by that admin.
- Account checks in the owner and admin dashboards wait for Firebase Authentication to restore the signed-in session.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Public homepage, marketplace filters, About section, and footer |
| `app.js` | Loads public vehicle listings, renders cards, filters results, and prepares WhatsApp enquiries |
| `style.css` | Shared responsive styling |
| `firebase-config.js` | Firebase app, Authentication, and Firestore initialization |
| `login.html` | Email/password sign-in, account-profile checks, role-based dashboard redirects, and on-page diagnostics |
| `owner.html` | Owner dashboard layout |
| `owner.js` | Verifies the owner, creates admins using a secondary Firebase app, lists admin profiles, and counts cars |
| `admin.html` | Admin dashboard and vehicle-entry form |
| `admin.js` | Verifies admin access, adds vehicles, lists the current admin's vehicles, and deletes their own listings |

## Firebase setup

The current `firebase-config.js` points to the Firebase project with project ID `kiri-cars`. Keep the configuration consistent across the project and any deployed copy of the website.

1. In Firebase Authentication, enable the **Email/Password** sign-in provider.
2. Create the owner account in Authentication.
3. In Cloud Firestore, create an `admins` collection.
4. Create a document whose ID is exactly the owner's Firebase Authentication UID.
5. Give that document these fields:

   | Field | Type | Owner value |
   | --- | --- | --- |
   | `name` | string | Owner's display name |
   | `email` | string | Owner's sign-in email |
   | `role` | string | `owner` |
   | `active` | Boolean | `true` |

The `active` field must be a real Boolean value, not the text string `"true"`. The document ID must match the UID exactly. The example below is illustrative; do not use it as a real credential.

```json
{
  "name": "Kiri Cars Owner",
  "email": "owner@example.com",
  "role": "owner",
  "active": true
}
```

Administrators created from the Owner Dashboard receive an `admins/{uid}` profile with `role: "admin"`, `active: true`, and metadata fields `createdAt` and `createdBy`. Their account is also created in Firebase Authentication.

## Firestore data model

### `admins/{uid}`

Each account document uses the Firebase Authentication UID as its document ID. Required access-control fields are `role` and Boolean `active`; `name` and `email` are used for display and account records.

Supported roles:
- `owner` — owner dashboard access and account administration.
- `admin` — showroom dashboard access and management of listings that admin added.

### `cars/{carId}`

The admin form writes these fields:

| Field | Type / notes |
| --- | --- |
| `manufacturer` | string |
| `carType` | string |
| `model` | string |
| `year` | number |
| `price` | number in KSh |
| `status` | string: `Locally Used`, `Fresh Import`, or `Brand New` |
| `mileage` | number or null |
| `fuel` | string |
| `transmission` | string |
| `description` | string |
| `imageUrl` | optional HTTPS image URL |
| `addedBy` | string containing the creator's Firebase UID |
| `createdAt` | Firestore server timestamp |

The current form accepts an image URL; it does **not** upload image files to Firebase Storage.

## How login works and how to troubleshoot it

1. The login page signs in with Firebase Authentication.
2. It reads `admins/{signedInUser.uid}` from Firestore.
3. It checks that `active` is Boolean `true`.
4. It redirects accounts with role `owner` to `owner.html`, and accounts with role `admin` to `admin.html`.

The login page currently includes an on-screen **KIRI CARS DIAGNOSTICS** area. If login fails after the email and password are accepted, read that area for the project ID, signed-in UID, document path, whether the document exists, the field names returned, the value/type of `active`, the role, or a Firebase error. Use those details to locate the actual cause rather than changing fields or rules blindly.

If the account is not authorized, check the exact document path shown in diagnostics. A profile document for a different UID will not authorize the signed-in user.

## Firestore security rules

Firestore Security Rules must enforce access at the database, not just through the page redirects. The intended access model is:

- Public visitors can read vehicle listings.
- Only the owner can create, update, or delete administrator profile documents.
- The owner can manage all vehicle listings.
- An active admin can create a vehicle only when its `addedBy` field matches that admin's UID.
- An admin can update or delete only their own listings while their account is active and has role `admin`.

Review and test rules against these requirements before using the site with real customers. Do not use unrestricted public write access. The browser-side role checks are not a substitute for Firestore Security Rules.

## Deploy and test

Keep these nine files in the website root. For a static hosting deployment:

1. Confirm `firebase-config.js` points to the intended Firebase project.
2. Deploy the current repository files to your hosting provider.
3. Add the deployed website's domain under Firebase Authentication's authorized domains, if required by the host.
4. Test owner sign-in and owner dashboard access.
5. Create a test admin and verify that the owner remains signed in.
6. Test admin sign-in, adding a vehicle, and deleting a listing created by that admin.
7. Open the public homepage and test listing display and all filters.
8. Test the WhatsApp enquiry flow.

## Current limitations

- Vehicle cards are shown on the homepage; there is no separate vehicle detail page in the current code.
- The WhatsApp URL uses `https://wa.me/?text=...` without a preconfigured Kiri Cars business phone number. Visitors may need to select a contact. Set the intended business number in international format before launch if enquiries should go directly to Kiri Cars.
- Vehicle photos must be provided as image URLs; file upload/storage is not implemented.
- Verify all Firestore rules and account permissions before making the marketplace public.
