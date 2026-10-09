# Kiri Cars Website

Kiri Cars is a public vehicle marketplace built with HTML, CSS, JavaScript ES modules, Firebase Authentication, and Cloud Firestore.

Repository: https://github.com/joemwangi56789-web/Kiri-Carss

## Current project files

| File | Responsibility |
| --- | --- |
| `index.html` | Public landing page, vehicle search/filter form, About section |
| `app.js` | Reads public listings from Firestore, builds vehicle cards, applies filters, opens a WhatsApp enquiry |
| `style.css` | Shared visual design and responsive layout |
| `firebase-config.js` | Initializes Firebase app, Authentication, and Firestore |
| `login.html` | Email/password sign-in, reads account profile and redirects based on role |
| `owner.html` | Owner dashboard markup |
| `owner.js` | Owner checks, admin creation, account list, total vehicle count, sign-out |
| `admin.html` | Admin dashboard and add-vehicle form |
| `admin.js` | Admin authorization, creates listings, loads the admin's own listings, deletes own listings |

## How the website works

### Public marketplace

The homepage reads documents from the Firestore `cars` collection. It uses fields such as manufacturer, model, car type, year, status, price, fuel, transmission, mileage, description, and optional image URL. Visitors can filter the results. The enquiry button opens WhatsApp with a prefilled message; the current URL uses `https://wa.me/?text=...` without a fixed business phone number, so the visitor may need to choose a WhatsApp contact.

### Login and account roles

The login page signs in using Firebase Authentication, then reads the Firestore document `admins/{uid}`, where `uid` is the signed-in Firebase user's UID.

The account profile must include:
- `name`: string
- `email`: string
- `role`: exactly `owner` or `admin`
- `active`: Boolean `true`

The `active` field must be a Boolean, not the text value `"true"`. The Firestore document ID must exactly match the Authentication UID. If a profile document is missing or the role/active values do not match, login will not proceed to the dashboard.

### Owner dashboard

The owner dashboard checks that the signed-in profile is active and has role `owner`. It can create admin accounts, list profile documents, count vehicle listings, and sign out. Admin creation uses a secondary Firebase app so creating an admin does not replace the owner's main sign-in session.

### Admin dashboard

The admin dashboard checks that the signed-in profile is active and has role `admin`. It saves new vehicle documents with `addedBy` set to the admin's Authentication UID. The dashboard queries and displays only listings with that UID and checks ownership before deleting a listing.

## Firestore data model

### `admins/{uid}`

Example profile for an owner:

```json
{
  "name": "Kiri Cars Owner",
  "email": "owner@example.com",
  "role": "owner",
  "active": true
}
```

This is an illustrative example, not an actual account credential. Create the document ID using the real owner UID from Firebase Authentication.

Admin profiles created by the owner also include `createdAt` as a Firestore timestamp and `createdBy` as the owner's UID.

### `cars/{carId}`

The admin form writes these fields:
- `manufacturer` (string)
- `carType` (string)
- `model` (string)
- `year` (number)
- `price` (number)
- `status` (string)
- `mileage` (number or null)
- `fuel` (string)
- `transmission` (string)
- `description` (string)
- `imageUrl` (string; optional)
- `addedBy` (string UID)
- `createdAt` (Firestore timestamp)

## Login problem: what the source code tells us

The current `login.html` explicitly checks:

```js
if (profile.active !== true) {
  // sign out and display the active-field error
}
```

Therefore, if the page reports that the profile was found but `active` is `undefined`, the code successfully found a document at `admins/{currentUserUid}`, but that document did not contain a readable field named exactly `active`. This message points first to Firestore profile data, not a wrong password.

### Steps to check in Firebase Console

1. Open the Firebase project configured in `firebase-config.js` (project ID `kiri-cars`).
2. Go to Authentication and find the account you are trying to sign in with.
3. Copy that account's UID.
4. Open Firestore Database and the `admins` collection.
5. Open the document whose document ID exactly equals that UID.
6. Add or correct `active`: field type **Boolean**, value **true**.
7. Set `role` to exactly `owner` for the owner account or `admin` for an admin account.
8. Save and try signing in again.

If the document ID is correct but the error remains, verify that the browser is loading this same Firebase project and not an older WebCode deployment/configuration.

## Code issue to address

In `owner.js`, `requireOwner()` immediately reads `auth.currentUser` during module startup. Firebase may still be restoring the persisted session at that moment, so `currentUser` can temporarily be `null` even when the owner previously signed in. That can cause an unnecessary redirect to the login page when opening or refreshing the owner dashboard. A robust fix is to wait for Firebase's `onAuthStateChanged(auth, callback)` before checking the profile and loading owner data.

This is separate from the reported `active: undefined` login message and should be tested independently.

## Security rules requirements

Firestore rules must enforce permissions on the database itself:
- Public visitors can read car listings.
- Only the owner can create/update/delete admin profile documents.
- The owner can manage all car listings.
- An active admin can add listings only when `addedBy` equals their UID.
- An admin can update/delete only their own listings and only while their profile remains active with role `admin`.

Do not use public read/write rules as a shortcut. Front-end redirects alone do not secure Firestore.

## Setup and deployment checklist

1. Keep all nine source files in the website root with the filenames listed above.
2. Verify the Firebase project values in `firebase-config.js`.
3. Enable Email/Password in Firebase Authentication if that is the chosen sign-in method.
4. Create the owner Authentication user and matching `admins/{uid}` Firestore profile.
5. Publish Firestore rules matching the role and ownership model.
6. Test owner login, admin creation, admin login, adding a vehicle, public search, and admin deletion restrictions.
7. Deploy the static files to a hosting provider and configure authorized domains in Firebase Authentication.
8. For WhatsApp enquiries to go to the Kiri Cars business directly, update the WhatsApp URL to include the intended business phone number in international format.

## Known limitations / checks

- The current homepage does not show a dedicated detail page for each car; listings are displayed as cards.
- The WhatsApp link does not currently specify a Kiri Cars business number.
- Owner dashboard session restoration should be updated to wait for Firebase auth state.
- The reported login issue should be resolved by verifying the exact owner/admin profile document and the Boolean `active` field before changing code or database rules.
