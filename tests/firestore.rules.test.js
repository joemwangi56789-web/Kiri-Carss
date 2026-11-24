import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp
} from "firebase/firestore";

const projectId = "demo-kiri-cars";
const DAY = 24 * 60 * 60 * 1000;
let testEnv;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

function dealerProfile(extra = {}) {
  return {
    name: "Test Dealer",
    email: "dealer@example.test",
    role: "dealer",
    active: true,
    approvalStatus: "approved",
    freeListingEligible: false,
    ...extra
  };
}

function carData(addedBy, extra = {}) {
  return {
    manufacturer: "Toyota",
    carType: "sedan",
    model: "Corolla",
    year: 2020,
    price: 1500000,
    status: "Locally Used",
    mileage: 50000,
    fuel: "petrol",
    transmission: "automatic",
    description: "Rules test vehicle",
    vehicleRelationship: "owner",
    authorizationConfirmed: true,
    images: ["https://example.test/car.jpg"],
    imageUrl: "https://example.test/car.jpg",
    addedBy,
    sellerWhatsApp: "254700000000",
    sellerName: "Test Dealer",
    createdAt: serverTimestamp(),
    ...extra
  };
}

async function seed(path, id, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path, id), data);
  });
}

test("new seller signup may carry policy version 1 but cannot choose another version", async () => {
  const newDealerDb = testEnv.authenticatedContext("new-policy-dealer", {
    email: "new-policy@example.test"
  }).firestore();
  await assertSucceeds(setDoc(doc(newDealerDb, "admins", "new-policy-dealer"), {
    name: "New Policy Dealer",
    email: "new-policy@example.test",
    role: "dealer",
    active: false,
    approvalStatus: "pending",
    verificationStatus: "pending",
    sellerType: "broker",
    businessName: "",
    whatsapp: "254700000000",
    freeListingPolicyVersion: 1,
    termsAccepted: true,
    termsVersion: "2026-11-07",
    termsAcceptedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: "new-policy-dealer"
  }));
  await assertFails(updateDoc(doc(newDealerDb, "admins", "new-policy-dealer"), {
    freeListingPolicyVersion: 2
  }));

  const invalidDealerDb = testEnv.authenticatedContext("invalid-policy-dealer", {
    email: "invalid-policy@example.test"
  }).firestore();
  await assertFails(setDoc(doc(invalidDealerDb, "admins", "invalid-policy-dealer"), {
    name: "Invalid Policy Dealer",
    email: "invalid-policy@example.test",
    role: "dealer",
    active: false,
    approvalStatus: "pending",
    verificationStatus: "pending",
    sellerType: "broker",
    businessName: "",
    whatsapp: "254700000001",
    freeListingPolicyVersion: 2,
    termsAccepted: true,
    termsVersion: "2026-11-07",
    termsAcceptedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: "invalid-policy-dealer"
  }));
});

test("pending dealer cannot publish a public vehicle", async () => {
  await seed("admins", "pending-1", {
    name: "Pending Dealer",
    email: "pending@example.test",
    role: "dealer",
    active: false,
    approvalStatus: "pending"
  });

  const db = testEnv.authenticatedContext("pending-1", {
    email: "pending@example.test"
  }).firestore();

  await assertFails(setDoc(doc(db, "cars", "pending-car"), carData("pending-1", {
    listingStatus: "active",
    paymentStatus: "free_trial",
    listingFee: 0,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
    freeTrialApprovedAt: serverTimestamp()
  })));
});

test("pending dealer can save a private draft and access it after owner approval", async () => {
  await seed("admins", "pending-draft-dealer", {
    name: "Pending Draft Dealer",
    email: "draft@example.test",
    role: "dealer",
    active: false,
    approvalStatus: "pending"
  });
  await seed("admins", "owner-1", { role: "owner", active: true });
  const dealerDb = testEnv.authenticatedContext("pending-draft-dealer", {
    email: "draft@example.test"
  }).firestore();
  const draftRef = doc(dealerDb, "dealerDrafts", "private-draft");

  await assertSucceeds(setDoc(draftRef, carData("pending-draft-dealer", {
    listingStatus: "draft",
    paymentStatus: "not_due",
    listingFee: 0
  })));

  const otherDb = testEnv.authenticatedContext("other-user").firestore();
  await assertFails(getDoc(doc(otherDb, "dealerDrafts", "private-draft")));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "admins", "pending-draft-dealer"), {
      active: true,
      approvalStatus: "approved"
    });
  });
  await assertSucceeds(getDoc(draftRef));
});

test("first approved dealer listing can initialize a 60-day free window and run for 75 days", async () => {
  await seed("admins", "dealer-1", dealerProfile({ freeListingEligible: true }));
  const db = testEnv.authenticatedContext("dealer-1", {
    email: "dealer@example.test"
  }).firestore();
  const profileRef = doc(db, "admins", "dealer-1");
  const carRef = doc(db, "cars", "free-car-1");

  await assertSucceeds(runTransaction(db, async (transaction) => {
    transaction.update(profileRef, {
      freeListingEligible: false,
      freeListingWindowStartedAt: serverTimestamp(),
      freeListingWindowEndsAt: Timestamp.fromMillis(Date.now() + 60 * DAY)
    });
    transaction.set(carRef, carData("dealer-1", {
      listingStatus: "active",
      paymentStatus: "free_trial",
      listingFee: 0,
      listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
      freeTrialApprovedAt: serverTimestamp()
    }));
  }));
});

test("approved dealer cannot self-grant free-window eligibility or initialize a window without owner authorization", async () => {
  await seed("admins", "legacy-dealer", dealerProfile({ freeListingEligible: false }));
  const db = testEnv.authenticatedContext("legacy-dealer", {
    email: "dealer@example.test"
  }).firestore();
  const profileRef = doc(db, "admins", "legacy-dealer");
  const carRef = doc(db, "cars", "unauthorized-free-car");

  await assertFails(updateDoc(profileRef, { freeListingEligible: true }));
  await assertFails(runTransaction(db, async (transaction) => {
    transaction.update(profileRef, {
      freeListingWindowStartedAt: serverTimestamp(),
      freeListingWindowEndsAt: Timestamp.fromMillis(Date.now() + 60 * DAY)
    });
    transaction.set(carRef, carData("legacy-dealer", {
      listingStatus: "active",
      paymentStatus: "free_trial",
      listingFee: 0,
      listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
      freeTrialApprovedAt: serverTimestamp()
    }));
  }));
});

test("approved dealer cannot restart or extend an already initialized free window", async () => {
  await seed("admins", "dealer-1", dealerProfile({
    freeListingWindowStartedAt: Timestamp.fromMillis(Date.now() - DAY),
    freeListingWindowEndsAt: Timestamp.fromMillis(Date.now() + 59 * DAY)
  }));
  const db = testEnv.authenticatedContext("dealer-1", {
    email: "dealer@example.test"
  }).firestore();

  await assertFails(updateDoc(doc(db, "admins", "dealer-1"), {
    freeListingWindowStartedAt: serverTimestamp(),
    freeListingWindowEndsAt: Timestamp.fromMillis(Date.now() + 60 * DAY)
  }));
});

test("approved dealer can publish additional free listings while the 60-day window is active", async () => {
  await seed("admins", "dealer-1", dealerProfile({
    freeListingWindowStartedAt: Timestamp.fromMillis(Date.now() - DAY),
    freeListingWindowEndsAt: Timestamp.fromMillis(Date.now() + 59 * DAY)
  }));
  const db = testEnv.authenticatedContext("dealer-1", {
    email: "dealer@example.test"
  }).firestore();

  await assertSucceeds(setDoc(doc(db, "cars", "free-car-2"), carData("dealer-1", {
    listingStatus: "active",
    paymentStatus: "free_trial",
    listingFee: 0,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
    freeTrialApprovedAt: serverTimestamp()
  })));
});

test("seller can create a paid hidden listing and its exactly linked pending payment atomically", async () => {
  await seed("admins", "dealer-1", dealerProfile({
    freeListingWindowStartedAt: Timestamp.fromMillis(Date.now() - 61 * DAY),
    freeListingWindowEndsAt: Timestamp.fromMillis(Date.now() - DAY)
  }));
  const db = testEnv.authenticatedContext("dealer-1", {
    email: "dealer@example.test"
  }).firestore();
  const carRef = doc(db, "cars", "paid-car-1");
  const paymentRef = doc(db, "listingPayments", "payment-1");

  await assertSucceeds(runTransaction(db, async (transaction) => {
    transaction.set(carRef, carData("dealer-1", {
      listingStatus: "pending_payment",
      paymentStatus: "pending",
      listingFee: 750,
      paymentId: paymentRef.id
    }));
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: carRef.id,
      sellerId: "dealer-1",
      amount: 750,
      status: "pending",
      paymentMethod: "awaiting_payment",
      createdAt: serverTimestamp()
    });
  }));
});

test("existing dealer with prior listings consumes stale free eligibility and creates a paid listing", async () => {
  await seed("admins", "existing-dealer", dealerProfile({ freeListingEligible: true }));
  await seed("cars", "existing-dealer-old-car", carData("existing-dealer", {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 750
  }));
  const db = testEnv.authenticatedContext("existing-dealer", {
    email: "dealer@example.test"
  }).firestore();
  const carRef = doc(db, "cars", "existing-dealer-paid-car");
  const paymentRef = doc(db, "listingPayments", "existing-dealer-payment");

  await assertSucceeds(runTransaction(db, async (transaction) => {
    transaction.update(doc(db, "admins", "existing-dealer"), {
      freeListingEligible: false
    });
    transaction.set(carRef, carData("existing-dealer", {
      listingStatus: "pending_payment",
      paymentStatus: "pending",
      listingFee: 750,
      paymentId: paymentRef.id
    }));
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: carRef.id,
      sellerId: "existing-dealer",
      amount: 750,
      status: "pending",
      paymentMethod: "awaiting_payment",
      createdAt: serverTimestamp()
    });
  }));
  const profileAfter = await getDoc(doc(db, "admins", "existing-dealer"));
  assert.equal(profileAfter.data().freeListingEligible, false);
});

test("seller cannot create a payment record linked to a different car ID", async () => {
  await seed("admins", "dealer-1", dealerProfile({
    freeListingWindowStartedAt: Timestamp.fromMillis(Date.now() - 61 * DAY),
    freeListingWindowEndsAt: Timestamp.fromMillis(Date.now() - DAY)
  }));
  const db = testEnv.authenticatedContext("dealer-1", {
    email: "dealer@example.test"
  }).firestore();
  const carRef = doc(db, "cars", "paid-car-2");
  const paymentRef = doc(db, "listingPayments", "payment-2");

  await assertFails(runTransaction(db, async (transaction) => {
    transaction.set(carRef, carData("dealer-1", {
      listingStatus: "pending_payment",
      paymentStatus: "pending",
      listingFee: 750,
      paymentId: paymentRef.id
    }));
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: "some-other-car",
      sellerId: "dealer-1",
      amount: 750,
      status: "pending",
      paymentMethod: "awaiting_payment",
      createdAt: serverTimestamp()
    });
  }));
});

test("buyers cannot read a seller's private listing payment record", async () => {
  await seed("listingPayments", "private-payment", {
    paymentId: "private-payment",
    listingId: "car-1",
    sellerId: "dealer-1",
    amount: 750,
    status: "pending"
  });
  const buyerDb = testEnv.authenticatedContext("buyer-1", {
    email: "buyer@example.test"
  }).firestore();

  await assertFails(getDoc(doc(buyerDb, "listingPayments", "private-payment")));
});

test("a seller can read only their own payment records and cannot change payment status", async () => {
  await seed("listingPayments", "seller-payment", {
    paymentId: "seller-payment",
    listingId: "seller-car",
    sellerId: "dealer-1",
    amount: 750,
    status: "pending"
  });
  const ownDb = testEnv.authenticatedContext("dealer-1").firestore();
  const otherDb = testEnv.authenticatedContext("dealer-2").firestore();

  await assertSucceeds(getDoc(doc(ownDb, "listingPayments", "seller-payment")));
  await assertFails(getDoc(doc(otherDb, "listingPayments", "seller-payment")));
  await assertFails(updateDoc(doc(ownDb, "listingPayments", "seller-payment"), {
    status: "verified"
  }));
});

test("non-owner accounts cannot read the owner audit log", async () => {
  await seed("auditLog", "owner-action", {
    action: "payment_verified",
    actorId: "owner-1",
    createdAt: Timestamp.fromMillis(Date.now())
  });
  const buyerDb = testEnv.authenticatedContext("buyer-1").firestore();
  const sellerDb = testEnv.authenticatedContext("dealer-1").firestore();

  await assertFails(getDoc(doc(buyerDb, "auditLog", "owner-action")));
  await assertFails(getDoc(doc(sellerDb, "auditLog", "owner-action")));
});

test("owner can verify a pending payment only in the same transaction that publishes its linked car", async () => {
  await seed("admins", "owner-1", {
    name: "Test Owner",
    email: "owner@example.test",
    role: "owner",
    active: true
  });
  await seed("cars", "car-to-verify", carData("dealer-1", {
    listingStatus: "pending_payment",
    paymentStatus: "pending",
    listingFee: 750,
    paymentId: "verify-payment"
  }));
  await seed("listingPayments", "verify-payment", {
    paymentId: "verify-payment",
    listingId: "car-to-verify",
    sellerId: "dealer-1",
    amount: 750,
    status: "pending",
    paymentMethod: "awaiting_payment"
  });
  const db = testEnv.authenticatedContext("owner-1", {
    email: "owner@example.test"
  }).firestore();

  await assertSucceeds(runTransaction(db, async (transaction) => {
    transaction.update(doc(db, "cars", "car-to-verify"), {
      listingStatus: "active",
      paymentStatus: "paid",
      listingFee: 750,
      paymentId: "verify-payment",
      listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
      paymentReference: "TEST-MPESA-001",
      paymentMethod: "M-Pesa",
      paymentAmount: 750,
      paymentNote: "TEST-MPESA-001",
      paymentVerifiedBy: "owner-1",
      paidAt: serverTimestamp()
    });
    transaction.update(doc(db, "listingPayments", "verify-payment"), {
      status: "verified",
      amount: 750,
      paymentMethod: "M-Pesa",
      reference: "TEST-MPESA-001",
      note: "TEST-MPESA-001",
      verifiedAt: serverTimestamp(),
      verifiedBy: "owner-1"
    });
  }));
});

test("owner cannot activate a paid listing without atomically verifying its linked payment", async () => {
  await seed("admins", "owner-1", { role: "owner", active: true });
  await seed("cars", "car-needing-payment", carData("dealer-1", {
    listingStatus: "pending_payment",
    paymentStatus: "pending",
    listingFee: 750,
    paymentId: "pending-payment"
  }));
  await seed("listingPayments", "pending-payment", {
    paymentId: "pending-payment",
    listingId: "car-needing-payment",
    sellerId: "dealer-1",
    amount: 750,
    status: "pending",
    paymentMethod: "awaiting_payment"
  });
  const db = testEnv.authenticatedContext("owner-1").firestore();

  await assertFails(updateDoc(doc(db, "cars", "car-needing-payment"), {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 750,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
    paymentReference: "NOT-VERIFIED",
    paymentMethod: "M-Pesa",
    paymentAmount: 750,
    paymentNote: "NOT-VERIFIED",
    paymentVerifiedBy: "owner-1",
    paidAt: serverTimestamp()
  }));
});

test("owner can manually renew an older expired listing with a linked verified payment", async () => {
  await seed("admins", "owner-1", { role: "owner", active: true });
  await seed("cars", "legacy-expired-car", carData("dealer-1", {
    listingStatus: "expired",
    paymentStatus: "free_trial",
    listingFee: 0,
    listingExpiresAt: Timestamp.fromMillis(Date.now() - DAY)
  }));
  const db = testEnv.authenticatedContext("owner-1").firestore();
  const carRef = doc(db, "cars", "legacy-expired-car");
  const paymentRef = doc(db, "listingPayments", "renewal-payment");

  await assertSucceeds(runTransaction(db, async (transaction) => {
    transaction.update(carRef, {
      listingStatus: "active",
      paymentStatus: "paid",
      paymentId: paymentRef.id,
      listingFee: 750,
      listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
      paymentReference: "RENEWAL-001",
      paymentMethod: "M-Pesa",
      paymentAmount: 750,
      paymentNote: "RENEWAL-001",
      paymentVerifiedBy: "owner-1",
      paidAt: serverTimestamp(),
      renewedAt: serverTimestamp()
    });
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: "legacy-expired-car",
      sellerId: "dealer-1",
      amount: 750,
      status: "verified",
      paymentMethod: "M-Pesa",
      reference: "RENEWAL-001",
      note: "RENEWAL-001",
      renewal: true,
      createdAt: serverTimestamp(),
      verifiedAt: serverTimestamp(),
      verifiedBy: "owner-1"
    });
  }));
});

test("owner cannot renew a sold listing", async () => {
  await seed("admins", "owner-1", {
    role: "owner",
    active: true
  });
  await seed("cars", "sold-car", carData("dealer-1", {
    listingStatus: "sold",
    paymentStatus: "paid",
    listingFee: 750,
    listingExpiresAt: Timestamp.fromMillis(Date.now() - DAY)
  }));
  const db = testEnv.authenticatedContext("owner-1").firestore();

  await assertFails(updateDoc(doc(db, "cars", "sold-car"), {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 750,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
    paymentReference: "CASH-RENEWAL",
    paymentVerifiedBy: "owner-1",
    paymentMethod: "Cash",
    paymentAmount: 750,
    paymentNote: "CASH-RENEWAL",
    paidAt: serverTimestamp(),
    renewedAt: serverTimestamp()
  }));
});

test("owner cannot renew a suspended listing", async () => {
  await seed("admins", "owner-1", { role: "owner", active: true });
  await seed("cars", "suspended-car", carData("dealer-1", {
    listingStatus: "suspended",
    paymentStatus: "paid",
    listingFee: 750,
    listingExpiresAt: Timestamp.fromMillis(Date.now() - DAY)
  }));
  const db = testEnv.authenticatedContext("owner-1").firestore();

  await assertFails(updateDoc(doc(db, "cars", "suspended-car"), {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 750,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
    paymentReference: "CASH-RENEWAL",
    paymentVerifiedBy: "owner-1",
    paymentMethod: "Cash",
    paymentAmount: 750,
    paymentNote: "CASH-RENEWAL",
    paidAt: serverTimestamp(),
    renewedAt: serverTimestamp()
  }));
});

test("owner cannot set a paid listing expiry beyond 75 days", async () => {
  await seed("admins", "owner-1", {
    role: "owner",
    active: true
  });
  await seed("cars", "expired-car", carData("dealer-1", {
    listingStatus: "expired",
    paymentStatus: "free_trial",
    listingFee: 0,
    listingExpiresAt: Timestamp.fromMillis(Date.now() - DAY)
  }));
  const db = testEnv.authenticatedContext("owner-1").firestore();

  await assertFails(updateDoc(doc(db, "cars", "expired-car"), {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 750,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 76 * DAY),
    paymentReference: "CASH-RENEWAL",
    paymentVerifiedBy: "owner-1",
    paymentMethod: "Cash",
    paymentAmount: 750,
    paymentNote: "CASH-RENEWAL",
    paidAt: serverTimestamp(),
    renewedAt: serverTimestamp()
  }));
});


// Regression coverage for owner-recorded renewals, expiry protection and one-time verification.
for (const method of ["M-Pesa", "Bank transfer", "Cash"]) {
  test(`owner can renew a legacy hidden pending listing without a payment record using ${method}`, async () => {
    await seed("admins", "owner-1", { role: "owner", active: true });
    await seed("cars", "legacy-hidden-car", carData("dealer-1", {
      listingStatus: "pending_payment",
      paymentStatus: "pending",
      listingFee: 750
      // Deliberately no paymentId or listingExpiresAt: this is an older hidden listing.
    }));

    const db = testEnv.authenticatedContext("owner-1").firestore();
    const carRef = doc(db, "cars", "legacy-hidden-car");
    const paymentRef = doc(db, "listingPayments", `legacy-renewal-${method.toLowerCase().replace(/[^a-z]+/g, "-")}`);
    const reference = `LEGACY-${method.toUpperCase().replace(/[^A-Z]+/g, "")}-001`;

    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.update(carRef, {
        listingStatus: "active",
        paymentStatus: "paid",
        paymentId: paymentRef.id,
        listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY - 60_000),
        paymentReference: reference,
        paymentMethod: method,
        paymentAmount: 750,
        paymentNote: reference,
        paymentVerifiedBy: "owner-1",
        paidAt: serverTimestamp(),
        renewedAt: serverTimestamp()
      });
      transaction.set(paymentRef, {
        paymentId: paymentRef.id,
        listingId: "legacy-hidden-car",
        sellerId: "dealer-1",
        amount: 750,
        status: "verified",
        paymentMethod: method,
        reference,
        note: reference,
        renewal: true,
        createdAt: serverTimestamp(),
        verifiedAt: serverTimestamp(),
        verifiedBy: "owner-1"
      });
    }));

    const renewed = await getDoc(carRef);
    const payment = await getDoc(paymentRef);
    assert.equal(renewed.data().listingStatus, "active");
    assert.equal(renewed.data().paymentMethod, method);
    assert.equal(renewed.data().paymentId, paymentRef.id);
    assert.equal(payment.data().status, "verified");
    assert.equal(payment.data().sellerId, "dealer-1");
  });
}

test("seller cannot extend or rewrite the expiry of their own active listing", async () => {
  await seed("admins", "expiry-tamper-dealer", dealerProfile({
    freeListingWindowStartedAt: Timestamp.fromMillis(Date.now() - DAY),
    freeListingWindowEndsAt: Timestamp.fromMillis(Date.now() + 59 * DAY)
  }));
  await seed("cars", "expiry-protected-car", carData("expiry-tamper-dealer", {
    listingStatus: "active",
    paymentStatus: "free_trial",
    listingFee: 0,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 10 * DAY),
    freeTrialApprovedAt: Timestamp.fromMillis(Date.now() - DAY)
  }));

  const db = testEnv.authenticatedContext("expiry-tamper-dealer").firestore();
  await assertFails(updateDoc(doc(db, "cars", "expiry-protected-car"), {
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 365 * DAY)
  }));
});

test("owner cannot renew a listing before its current expiry", async () => {
  await seed("admins", "owner-1", { role: "owner", active: true });
  await seed("cars", "still-active-car", carData("dealer-1", {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 750,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 10 * DAY)
  }));

  const db = testEnv.authenticatedContext("owner-1").firestore();
  const carRef = doc(db, "cars", "still-active-car");
  const paymentRef = doc(db, "listingPayments", "premature-renewal");
  await assertFails(runTransaction(db, async (transaction) => {
    transaction.update(carRef, {
      listingStatus: "active",
      paymentStatus: "paid",
      paymentId: paymentRef.id,
      listingExpiresAt: Timestamp.fromMillis(Date.now() + 85 * DAY),
      paymentReference: "TOO-EARLY",
      paymentMethod: "Cash",
      paymentAmount: 750,
      paymentNote: "TOO-EARLY",
      paymentVerifiedBy: "owner-1",
      paidAt: serverTimestamp(),
      renewedAt: serverTimestamp()
    });
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: "still-active-car",
      sellerId: "dealer-1",
      amount: 750,
      status: "verified",
      paymentMethod: "Cash",
      reference: "TOO-EARLY",
      note: "TOO-EARLY",
      renewal: true,
      createdAt: serverTimestamp(),
      verifiedAt: serverTimestamp(),
      verifiedBy: "owner-1"
    });
  }));
});

test("owner cannot verify the same payment record twice", async () => {
  await seed("admins", "owner-1", { role: "owner", active: true });
  await seed("cars", "duplicate-check-car", carData("dealer-1", {
    listingStatus: "pending_payment",
    paymentStatus: "pending",
    listingFee: 750,
    paymentId: "duplicate-check-payment"
  }));
  await seed("listingPayments", "duplicate-check-payment", {
    paymentId: "duplicate-check-payment",
    listingId: "duplicate-check-car",
    sellerId: "dealer-1",
    amount: 750,
    status: "pending",
    paymentMethod: "awaiting_payment"
  });

  const db = testEnv.authenticatedContext("owner-1").firestore();
  const carRef = doc(db, "cars", "duplicate-check-car");
  const paymentRef = doc(db, "listingPayments", "duplicate-check-payment");
  await assertSucceeds(runTransaction(db, async (transaction) => {
    transaction.update(carRef, {
      listingStatus: "active",
      paymentStatus: "paid",
      listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY - 60_000),
      paymentReference: "DUPLICATE-001",
      paymentMethod: "M-Pesa",
      paymentAmount: 750,
      paymentNote: "DUPLICATE-001",
      paymentVerifiedBy: "owner-1",
      paidAt: serverTimestamp()
    });
    transaction.update(paymentRef, {
      status: "verified",
      amount: 750,
      paymentMethod: "M-Pesa",
      reference: "DUPLICATE-001",
      note: "DUPLICATE-001",
      verifiedAt: serverTimestamp(),
      verifiedBy: "owner-1"
    });
  }));

  await assertFails(updateDoc(paymentRef, {
    status: "verified",
    amount: 750,
    paymentMethod: "M-Pesa",
    reference: "DUPLICATE-001",
    note: "DUPLICATE-001",
    verifiedAt: serverTimestamp(),
    verifiedBy: "owner-1"
  }));
});


test("seller cannot understate the listing fee for the vehicle price", async () => {
  await seed("admins", "underprice-dealer", dealerProfile({
    freeListingWindowStartedAt: Timestamp.fromMillis(Date.now() - 61 * DAY),
    freeListingWindowEndsAt: Timestamp.fromMillis(Date.now() - DAY)
  }));
  const db = testEnv.authenticatedContext("underprice-dealer").firestore();
  const carRef = doc(db, "cars", "underpriced-car");
  const paymentRef = doc(db, "listingPayments", "underpriced-payment");

  await assertFails(runTransaction(db, async (transaction) => {
    transaction.set(carRef, carData("underprice-dealer", {
      listingStatus: "pending_payment",
      paymentStatus: "pending",
      listingFee: 300,
      paymentId: paymentRef.id
    }));
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: carRef.id,
      sellerId: "underprice-dealer",
      amount: 300,
      status: "pending",
      paymentMethod: "awaiting_payment",
      createdAt: serverTimestamp()
    });
  }));
});

test("owner cannot verify a payment amount different from the price-based listing fee", async () => {
  await seed("admins", "owner-1", { role: "owner", active: true });
  await seed("cars", "wrong-amount-car", carData("dealer-1", {
    listingStatus: "pending_payment",
    paymentStatus: "pending",
    listingFee: 750,
    paymentId: "wrong-amount-payment"
  }));
  await seed("listingPayments", "wrong-amount-payment", {
    paymentId: "wrong-amount-payment",
    listingId: "wrong-amount-car",
    sellerId: "dealer-1",
    amount: 750,
    status: "pending",
    paymentMethod: "awaiting_payment"
  });
  const db = testEnv.authenticatedContext("owner-1").firestore();

  await assertFails(runTransaction(db, async (transaction) => {
    transaction.update(doc(db, "cars", "wrong-amount-car"), {
      listingStatus: "active",
      paymentStatus: "paid",
      listingFee: 750,
      listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
      paymentReference: "UNDERPAID-001",
      paymentMethod: "M-Pesa",
      paymentAmount: 300,
      paymentNote: "UNDERPAID-001",
      paymentVerifiedBy: "owner-1",
      paidAt: serverTimestamp()
    });
    transaction.update(doc(db, "listingPayments", "wrong-amount-payment"), {
      status: "verified",
      amount: 300,
      paymentMethod: "M-Pesa",
      reference: "UNDERPAID-001",
      note: "UNDERPAID-001",
      verifiedAt: serverTimestamp(),
      verifiedBy: "owner-1"
    });
  }));
});


test("buyer with current Terms can publish a story, but a buyer without acceptance cannot", async () => {
  await seed("buyers", "story-author", {
    name: "Story Author",
    role: "buyer",
    active: true,
    termsAccepted: true,
    termsVersion: "2026-11-07"
  });
  await seed("buyers", "unaccepted-author", {
    name: "Unaccepted Author",
    role: "buyer",
    active: true
  });

  const storyData = (authorId, authorName) => ({
    title: "A Kiri Stories test article",
    category: "Automotive",
    excerpt: "A short test introduction.",
    blocks: [{ type: "text", text: "This is a test paragraph." }],
    authorId,
    authorName,
    authorRole: "buyer",
    status: "published",
    authorDeclaration: true,
    termsVersion: "2026-11-07",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const acceptedDb = testEnv.authenticatedContext("story-author").firestore();
  await assertSucceeds(setDoc(doc(acceptedDb, "stories", "accepted-story"), storyData("story-author", "Story Author")));

  const unacceptedDb = testEnv.authenticatedContext("unaccepted-author").firestore();
  await assertFails(setDoc(doc(unacceptedDb, "stories", "unaccepted-story"), storyData("unaccepted-author", "Unaccepted Author")));
});

test("only the owner can suspend a buyer after a story report", async () => {
  await seed("admins", "story-owner", { name: "Owner", role: "owner", active: true });
  await seed("buyers", "story-buyer", { name: "Story Buyer", role: "buyer", active: true });
  const ownerDb = testEnv.authenticatedContext("story-owner").firestore();
  const buyerDb = testEnv.authenticatedContext("story-buyer").firestore();

  await assertSucceeds(updateDoc(doc(ownerDb, "buyers", "story-buyer"), {
    active: false,
    accountStatus: "suspended"
  }));
  await assertFails(updateDoc(doc(buyerDb, "buyers", "story-buyer"), {
    active: false,
    accountStatus: "banned"
  }));
});


test("story authors can edit only their own published article", async () => {
  await seed("buyers", "story-owner-author", { name: "Author", role: "buyer", active: true, termsAccepted: true, termsVersion: "2026-11-07" });
  await seed("buyers", "other-story-user", { name: "Other User", role: "buyer", active: true, termsAccepted: true, termsVersion: "2026-11-07" });
  await seed("stories", "editable-story", {
    title: "Original story title",
    category: "Automotive",
    excerpt: "",
    blocks: [{ type: "text", text: "Original paragraph." }],
    authorId: "story-owner-author",
    authorName: "Author",
    authorRole: "buyer",
    status: "published",
    authorDeclaration: true,
    termsVersion: "2026-11-07",
    createdAt: Timestamp.fromMillis(Date.now() - 1000),
    updatedAt: Timestamp.fromMillis(Date.now() - 1000)
  });

  const authorDb = testEnv.authenticatedContext("story-owner-author").firestore();
  const otherDb = testEnv.authenticatedContext("other-story-user").firestore();
  await assertSucceeds(updateDoc(doc(authorDb, "stories", "editable-story"), {
    title: "Updated story title",
    category: "Automotive",
    excerpt: "Updated introduction",
    blocks: [{ type: "text", text: "Updated paragraph." }],
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(otherDb, "stories", "editable-story"), {
    title: "Someone else's edit",
    updatedAt: serverTimestamp()
  }));
});

test("active members can like, comment on and rate a published story under their own account", async () => {
  await seed("buyers", "story-reader", { name: "Story Reader", role: "buyer", active: true });
  await seed("buyers", "another-reader", { name: "Another Reader", role: "buyer", active: true });
  await seed("stories", "social-story", {
    title: "Community story",
    authorId: "story-author",
    authorName: "Story Author",
    status: "published"
  });

  const readerDb = testEnv.authenticatedContext("story-reader").firestore();
  const otherDb = testEnv.authenticatedContext("another-reader").firestore();
  const likeRef = doc(readerDb, "stories", "social-story", "likes", "story-reader");
  const commentRef = doc(readerDb, "stories", "social-story", "comments", "reader-comment");
  const ratingRef = doc(readerDb, "stories", "social-story", "ratings", "story-reader");

  await assertSucceeds(setDoc(likeRef, {
    userId: "story-reader",
    createdAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(commentRef, {
    authorId: "story-reader",
    authorName: "Story Reader",
    text: "Useful article.",
    status: "visible",
    createdAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(ratingRef, {
    userId: "story-reader",
    rating: 5,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(ratingRef, {
    rating: 4,
    updatedAt: serverTimestamp()
  }));

  await assertFails(setDoc(doc(otherDb, "stories", "social-story", "likes", "story-reader"), {
    userId: "story-reader",
    createdAt: serverTimestamp()
  }));
});
