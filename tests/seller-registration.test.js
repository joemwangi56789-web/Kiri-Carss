import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

const projectId = "demo-kiri-cars";
let app;
let auth;
let db;
let testEnv;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });

  app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: "localhost",
    projectId
  }, "seller-registration-flow-test");

  auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true
  });

  db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
});

after(async () => {
  if (auth?.currentUser) await signOut(auth).catch(() => {});
  if (app) await deleteApp(app);
  if (testEnv) await testEnv.cleanup();
});

test("new seller can register, receive a pending profile, and be approved by the owner", async () => {
  await testEnv.clearFirestore();

  const unique = Date.now();
  const sellerEmail = `seller-${unique}@example.test`;
  const sellerPassword = "KiriCarsTest123!";
  const sellerCredential = await createUserWithEmailAndPassword(
    auth,
    sellerEmail,
    sellerPassword
  );
  const sellerUid = sellerCredential.user.uid;
  const sellerProfileRef = doc(db, "admins", sellerUid);

  await setDoc(sellerProfileRef, {
    name: "Test Seller",
    email: sellerEmail,
    role: "dealer",
    active: false,
    approvalStatus: "pending",
    verificationStatus: "pending",
    sellerType: "broker",
    businessName: "",
    whatsapp: "254712345678",
    freeListingPolicyVersion: 1,
    createdAt: serverTimestamp(),
    createdBy: sellerUid
  });

  const pendingProfile = await getDoc(sellerProfileRef);
  assert.equal(pendingProfile.exists(), true);
  assert.equal(pendingProfile.data().role, "dealer");
  assert.equal(pendingProfile.data().active, false);
  assert.equal(pendingProfile.data().approvalStatus, "pending");
  assert.equal(pendingProfile.data().freeListingPolicyVersion, 1);

  await signOut(auth);
  const ownerEmail = `owner-${unique}@example.test`;
  const ownerCredential = await createUserWithEmailAndPassword(
    auth,
    ownerEmail,
    sellerPassword
  );
  const ownerUid = ownerCredential.user.uid;

  // Seed the owner identity only in the local emulator, never in production.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "admins", ownerUid), {
      name: "Test Owner",
      email: ownerEmail,
      role: "owner",
      active: true
    });
  });

  await updateDoc(sellerProfileRef, {
    approvalStatus: "approved",
    active: true,
    freeListingEligible: true,
    freeListingEligibilityReviewedAt: serverTimestamp(),
    freeListingEligibilityReviewedBy: ownerUid,
    approvalUpdatedAt: serverTimestamp(),
    approvalUpdatedBy: ownerUid
  });

  await signOut(auth);
  await signInWithEmailAndPassword(auth, sellerEmail, sellerPassword);
  const approvedProfile = await getDoc(sellerProfileRef);

  assert.equal(approvedProfile.data().active, true);
  assert.equal(approvedProfile.data().approvalStatus, "approved");
  assert.equal(approvedProfile.data().freeListingEligible, true);
  assert.equal(approvedProfile.data().freeListingPolicyVersion, 1);
});
