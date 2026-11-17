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
      listingFee: 25000,
      paymentId: paymentRef.id
    }));
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: carRef.id,
      sellerId: "dealer-1",
      amount: 25000,
      status: "pending",
      paymentMethod: "awaiting_payment",
      createdAt: serverTimestamp()
    });
  }));
});

test("existing dealer without free eligibility can create a paid listing but not a free one", async () => {
  await seed("admins", "existing-dealer", dealerProfile({ freeListingEligible: false }));
  await seed("cars", "existing-dealer-old-car", carData("existing-dealer", {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 25000
  }));
  const db = testEnv.authenticatedContext("existing-dealer", {
    email: "dealer@example.test"
  }).firestore();
  const carRef = doc(db, "cars", "existing-dealer-paid-car");
  const paymentRef = doc(db, "listingPayments", "existing-dealer-payment");

  await assertSucceeds(runTransaction(db, async (transaction) => {
    transaction.set(carRef, carData("existing-dealer", {
      listingStatus: "pending_payment",
      paymentStatus: "pending",
      listingFee: 25000,
      paymentId: paymentRef.id
    }));
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: carRef.id,
      sellerId: "existing-dealer",
      amount: 25000,
      status: "pending",
      paymentMethod: "awaiting_payment",
      createdAt: serverTimestamp()
    });
  }));
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
      listingFee: 25000,
      paymentId: paymentRef.id
    }));
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: "some-other-car",
      sellerId: "dealer-1",
      amount: 25000,
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
    amount: 25000,
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
    amount: 25000,
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
    listingFee: 25000,
    paymentId: "verify-payment"
  }));
  await seed("listingPayments", "verify-payment", {
    paymentId: "verify-payment",
    listingId: "car-to-verify",
    sellerId: "dealer-1",
    amount: 25000,
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
      listingFee: 25000,
      paymentId: "verify-payment",
      listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
      paymentReference: "TEST-MPESA-001",
      paymentMethod: "M-Pesa",
      paymentAmount: 25000,
      paymentNote: "TEST-MPESA-001",
      paymentVerifiedBy: "owner-1",
      paidAt: serverTimestamp()
    });
    transaction.update(doc(db, "listingPayments", "verify-payment"), {
      status: "verified",
      amount: 25000,
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
    listingFee: 25000,
    paymentId: "pending-payment"
  }));
  await seed("listingPayments", "pending-payment", {
    paymentId: "pending-payment",
    listingId: "car-needing-payment",
    sellerId: "dealer-1",
    amount: 25000,
    status: "pending",
    paymentMethod: "awaiting_payment"
  });
  const db = testEnv.authenticatedContext("owner-1").firestore();

  await assertFails(updateDoc(doc(db, "cars", "car-needing-payment"), {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 25000,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
    paymentReference: "NOT-VERIFIED",
    paymentMethod: "M-Pesa",
    paymentAmount: 25000,
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
      listingFee: 25000,
      listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
      paymentReference: "RENEWAL-001",
      paymentMethod: "M-Pesa",
      paymentAmount: 25000,
      paymentNote: "RENEWAL-001",
      paymentVerifiedBy: "owner-1",
      paidAt: serverTimestamp(),
      renewedAt: serverTimestamp()
    });
    transaction.set(paymentRef, {
      paymentId: paymentRef.id,
      listingId: "legacy-expired-car",
      sellerId: "dealer-1",
      amount: 25000,
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
    listingFee: 25000,
    listingExpiresAt: Timestamp.fromMillis(Date.now() - DAY)
  }));
  const db = testEnv.authenticatedContext("owner-1").firestore();

  await assertFails(updateDoc(doc(db, "cars", "sold-car"), {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 25000,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
    paymentReference: "CASH-RENEWAL",
    paymentVerifiedBy: "owner-1",
    paymentMethod: "Cash",
    paymentAmount: 25000,
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
    listingFee: 25000,
    listingExpiresAt: Timestamp.fromMillis(Date.now() - DAY)
  }));
  const db = testEnv.authenticatedContext("owner-1").firestore();

  await assertFails(updateDoc(doc(db, "cars", "suspended-car"), {
    listingStatus: "active",
    paymentStatus: "paid",
    listingFee: 25000,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 75 * DAY),
    paymentReference: "CASH-RENEWAL",
    paymentVerifiedBy: "owner-1",
    paymentMethod: "Cash",
    paymentAmount: 25000,
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
    listingFee: 25000,
    listingExpiresAt: Timestamp.fromMillis(Date.now() + 76 * DAY),
    paymentReference: "CASH-RENEWAL",
    paymentVerifiedBy: "owner-1",
    paymentMethod: "Cash",
    paymentAmount: 25000,
    paymentNote: "CASH-RENEWAL",
    paidAt: serverTimestamp(),
    renewedAt: serverTimestamp()
  }));
});
