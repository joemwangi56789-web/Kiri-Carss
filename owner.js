import { app, auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteField,
  writeBatch,
  query,
  where,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const ownerMessage = document.getElementById("ownerMessage");
const carCount = document.getElementById("carCount");
const adminsList = document.getElementById("adminsList");
const totalBuyerAccounts = document.getElementById("totalBuyerAccounts");
const totalDealerAccounts = document.getElementById("totalDealerAccounts");
const activeDealerAccounts = document.getElementById("activeDealerAccounts");
const inactiveDealerAccounts = document.getElementById("inactiveDealerAccounts");
const accountStatsMessage = document.getElementById("accountStatsMessage");
const recentAccountsList = document.getElementById("recentAccountsList");
const sellerApplicationsList = document.getElementById("sellerApplicationsList");
const sellerApplicationsMessage = document.getElementById("sellerApplicationsMessage");



const listingPaymentsList = document.getElementById("listingPaymentsList");
const listingPaymentsMessage = document.getElementById("listingPaymentsMessage");
const promoteOwnerForm = document.getElementById("promoteOwnerForm");
const promoteOwnerEmail = document.getElementById("promoteOwnerEmail");
const promoteOwnerButton = document.getElementById("promoteOwnerButton");
const promoteOwnerMessage = document.getElementById("promoteOwnerMessage");

function feeForPrice(price) {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (amount < 500000) return 300;
  if (amount < 1000000) return 500;
  if (amount < 2000000) return 750;
  if (amount < 4000000) return 1000;
  if (amount < 7000000) return 1500;
  if (amount < 10000000) return 2000;
  return 2500;
}
function timestampMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}
async function loadListingPayments() {
  if (!listingPaymentsList || !listingPaymentsMessage) return;
  listingPaymentsMessage.textContent = "Loading pending payments and expired listings...";
  listingPaymentsList.replaceChildren();
  try {
    const [carsSnapshot, adminsSnapshot] = await Promise.all([getDocs(collection(db, "cars")), getDocs(collection(db, "admins"))]);
    const profiles = new Map();
    adminsSnapshot.forEach((item) => profiles.set(item.id, item.data()));
    const now = Date.now();
    const queue = carsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((car) => {
      if (car.listingStatus === "sold" || car.listingStatus === "suspended") return false;
      const expiry = timestampMs(car.listingExpiresAt);
      return car.paymentStatus === "pending" || car.listingStatus === "pending_payment" || (expiry !== null && expiry <= now);
    }).sort((a, b) => (timestampMs(a.createdAt) || 0) - (timestampMs(b.createdAt) || 0));
    if (!queue.length) {
      listingPaymentsList.textContent = "No pending listing payments or expired listings.";
      listingPaymentsMessage.textContent = "Payment queue is clear.";
      return;
    }
    queue.forEach((car) => {
      const row = document.createElement("article");
      row.className = "admin-list-item";
      const title = document.createElement("strong");
      title.textContent = [car.year, car.manufacturer, car.model].filter(Boolean).join(" ") || "Vehicle listing";
      const seller = profiles.get(car.addedBy) || {};
      const details = document.createElement("p");
      details.textContent = "Seller: " + (seller.name || car.sellerName || car.addedBy || "Unknown") + " · Price: KSh " + Number(car.price || 0).toLocaleString("en-KE") + " · Fee: KSh " + feeForPrice(car.price).toLocaleString("en-KE");
      const status = document.createElement("p");
      const expiry = timestampMs(car.listingExpiresAt);
      status.textContent = "Listing: " + (car.listingStatus || "legacy") + " · Payment: " + (car.paymentStatus || "not recorded") + (expiry ? " · Expiry: " + new Date(expiry).toLocaleDateString("en-KE") : "");
      row.append(title, details, status);
      const actions = document.createElement("div");
      actions.className = "seller-review-actions";
      const addAction = (label, handler) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const successMessage = await handler(car, seller);
            await loadListingPayments();
            await loadCarCount();
            if (successMessage) listingPaymentsMessage.textContent = successMessage;
          } catch (error) {
            console.error("Listing payment action failed:", error);
            listingPaymentsMessage.textContent = "Could not update listing: " + (error.code || error.message);
            button.disabled = false;
          }
        });
        actions.appendChild(button);
      };
      const isExpired = expiry !== null && expiry <= now;
      if (isExpired && car.paymentStatus !== "pending") {
        addAction("Confirm Renewal Payment", async (listing) => {
          const reference = prompt("Enter the M-Pesa receipt/transaction code after checking the payment:");
          if (!reference || !reference.trim()) throw new Error("Renewal cancelled: M-Pesa receipt code is required.");
          if (!confirm("You have independently verified M-Pesa receipt " + reference.trim() + "? Renew for 30 days?")) throw new Error("Renewal cancelled.");
          await updateDoc(doc(db, "cars", listing.id), {
            listingStatus: "active", paymentStatus: "paid", listingFee: feeForPrice(listing.price),
            paymentReference: reference.trim(), paymentVerifiedBy: auth.currentUser.uid, paidAt: serverTimestamp(),
            listingExpiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), renewedAt: serverTimestamp()
          });
        });
      } else if (car.paymentStatus === "pending" || car.listingStatus === "pending_payment") {
        const started = timestampMs(seller.freeTrialStartedAt);
        const ends = timestampMs(seller.freeTrialEndsAt);
        const freeEligible = (started !== null && ends !== null && now < ends) || (started === null && seller.freeTrialUsed !== true);
        if (freeEligible) addAction("Approve Free Trial (60 days)", async (listing, profile) => {
          if (!confirm("Approve this listing under the seller's one-time 30-day free-trial window? This listing will run for 60 days.")) throw new Error("Free approval cancelled.");
          const currentTime = Date.now();
          const startAt = started === null ? Timestamp.fromDate(new Date(currentTime)) : profile.freeTrialStartedAt;
          const endAt = ends === null ? Timestamp.fromDate(new Date(currentTime + 30 * 24 * 60 * 60 * 1000)) : profile.freeTrialEndsAt;
          const batch = writeBatch(db);
          batch.update(doc(db, "admins", listing.addedBy), {
            freeTrialStartedAt: startAt,
            freeTrialEndsAt: endAt,
            freeTrialUsed: true
          });
          batch.update(doc(db, "cars", listing.id), {
            listingStatus: "active", paymentStatus: "free_trial", listingFee: 0, freeTrialApprovedAt: serverTimestamp(),
            listingExpiresAt: Timestamp.fromDate(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)), paymentVerifiedBy: auth.currentUser.uid
          });
          await batch.commit();
          return "Free trial approved. The vehicle is live for buyers and has been removed from the payment queue.";
        });
        addAction("Confirm M-Pesa Payment (30 days)", async (listing) => {
          const expectedFee = feeForPrice(listing.price);
          const reference = prompt("Enter the M-Pesa receipt/transaction code after checking that KSh " + expectedFee.toLocaleString("en-KE") + " was received:");
          if (!reference || !reference.trim()) throw new Error("Payment approval cancelled: M-Pesa receipt code is required.");
          if (!confirm("You have independently verified receipt " + reference.trim() + " for KSh " + expectedFee.toLocaleString("en-KE") + "? Publish for 30 days?")) throw new Error("Payment approval cancelled.");
          await updateDoc(doc(db, "cars", listing.id), {
            listingStatus: "active", paymentStatus: "paid", listingFee: expectedFee, paymentReference: reference.trim(),
            paymentVerifiedBy: auth.currentUser.uid, paidAt: serverTimestamp(),
            listingExpiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
          });
        });
      }
      row.appendChild(actions);
      listingPaymentsList.appendChild(row);
    });
    listingPaymentsMessage.textContent = "Loaded " + queue.length + " listing payment/renewal item(s).";
  } catch (error) {
    console.error("Load listing payment queue failed:", error);
    listingPaymentsMessage.textContent = "Could not load payment queue. Confirm the latest Firestore rules are published.";
  }
}

function setupOwnerNavigation() {
  const buttons = [...document.querySelectorAll("[data-owner-panel]")];
  const panels = [...document.querySelectorAll(".owner-panel")];
  function openPanel(name) {
    panels.forEach((panel) => { panel.hidden = panel.id !== "owner-panel-" + name; });
    buttons.forEach((button) => {
      const active = button.dataset.ownerPanel === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }
  buttons.forEach((button) => button.addEventListener("click", () => openPanel(button.dataset.ownerPanel)));
  document.querySelectorAll("[data-open-owner-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      openPanel(button.dataset.openOwnerPanel);
      document.getElementById("owner-panel-" + button.dataset.openOwnerPanel)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  openPanel("overview");
}

setupOwnerNavigation();

function showMessage(element, text, isError = false) {
  element.textContent = text;
  element.style.color = isError ? "#c62828" : "#167a35";
}

function normalizeKenyanPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) digits = "254" + digits.slice(1);
  else if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) digits = "254" + digits;
  return /^254[17]\d{8}$/.test(digits) ? digits : "";
}

// Now receives the user from onAuthStateChanged instead of reading
// auth.currentUser, which can still be null while the session is restoring.
async function requireOwner(user) {
  if (!user) {
    window.location.replace("login.html");
    return false;
  }

  const profileRef = doc(db, "admins", user.uid);
  const profileSnap = await getDoc(profileRef);

  if (!profileSnap.exists()) {
    await signOut(auth);
    window.location.replace("login.html");
    return false;
  }

  const profile = profileSnap.data();

  if (
    profile.active !== true ||
    String(profile.role || "").trim().toLowerCase() !== "owner"
  ) {
    await signOut(auth);
    window.location.replace("login.html");
    return false;
  }

  showMessage(
    ownerMessage,
    "Signed in as " + (profile.name || user.email) + ".",
    false
  );

  return true;
}

async function loadCarCount() {
  try {
    const snapshot = await getDocs(collection(db, "cars"));
    carCount.textContent = "Total vehicle listings: " + snapshot.size;
  } catch (error) {
    carCount.textContent = "Could not load vehicle count.";
    console.error("Car count error:", error);
  }
}

function formatRegistrationDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") return "Date not recorded";
  return timestamp.toDate().toLocaleString();
}

async function loadAccountStats() {
  accountStatsMessage.textContent = "Loading account statistics...";
  recentAccountsList.textContent = "Loading recent registrations...";

  try {
    const [buyersSnapshot, adminsSnapshot] = await Promise.all([
      getDocs(collection(db, "buyers")),
      getDocs(collection(db, "admins"))
    ]);

    const buyers = [];
    buyersSnapshot.forEach((item) => {
      const data = item.data();
      buyers.push({
        name: data.name || "Unnamed buyer",
        email: data.email || "No email recorded",
        type: "Buyer",
        createdAt: data.createdAt || null
      });
    });

    const dealers = [];
    adminsSnapshot.forEach((item) => {
      const data = item.data();
      const role = String(data.role || "").trim().toLowerCase();
      if (role !== "admin" && role !== "dealer") return;
      dealers.push({
        name: data.name || "Unnamed dealer",
        email: data.email || "No email recorded",
        type: data.sellerType === "broker" ? "Independent Sales Representative" :
          (data.sellerType === "dealership" ? "Showroom Representative" : "Seller category not recorded"),
        active: data.active === true,
        createdAt: data.createdAt || null
      });
    });

    const activeCount = dealers.filter((dealer) => dealer.active).length;
    totalBuyerAccounts.textContent = String(buyers.length);
    totalDealerAccounts.textContent = String(dealers.length);
    activeDealerAccounts.textContent = String(activeCount);
    inactiveDealerAccounts.textContent = String(dealers.length - activeCount);

    const recent = [...buyers, ...dealers].sort((a, b) => {
      const aTime = a.createdAt && typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    }).slice(0, 10);

    recentAccountsList.replaceChildren();

    if (recent.length === 0) {
      recentAccountsList.textContent = "No buyer or dealer accounts found.";
    } else {
      recent.forEach((account) => {
        const row = document.createElement("div");
        row.className = "admin-list-item";

        const name = document.createElement("strong");
        name.textContent = account.name;

        const details = document.createElement("p");
        details.textContent = account.email;

        const metadata = document.createElement("p");
        metadata.textContent = account.type +
          (account.type === "Dealer" ? " | " + (account.active ? "Active" : "Inactive") : "") +
          " | " + formatRegistrationDate(account.createdAt);

        row.append(name, details, metadata);
        recentAccountsList.appendChild(row);
      });
    }

    accountStatsMessage.textContent = "Account statistics updated successfully.";
    accountStatsMessage.style.color = "#167a35";
  } catch (error) {
    console.error("Account statistics error:", error);
    accountStatsMessage.textContent =
      "Could not load account statistics. Check that the published Firestore rules allow the owner to read buyer and administrator records.";
    accountStatsMessage.style.color = "#c62828";
    recentAccountsList.textContent = "Recent registrations could not be loaded.";
  }
}

async function loadAdmins() {
  adminsList.textContent = "Loading administrators...";

  try {
    const snapshot = await getDocs(collection(db, "admins"));

    adminsList.replaceChildren();

    if (snapshot.empty) {
      adminsList.textContent = "No administrator accounts found.";
      return;
    }

    snapshot.forEach((item) => {
      const data = item.data();

      const row = document.createElement("div");
      row.className = "admin-list-item";

      const name = document.createElement("strong");
      name.textContent = data.name || "Unnamed account";

      const email = document.createElement("p");
      email.textContent = data.email || "No email recorded";

      const role = document.createElement("p");
      role.textContent =
        "Role: " + (data.role || "unknown") +
        " | Status: " + (data.active === true ? "Active" : "Inactive");

      const whatsapp = document.createElement("p");
      whatsapp.textContent = "WhatsApp: " + (data.whatsapp || "Not provided");

      row.append(name, email, role, whatsapp);
      adminsList.appendChild(row);
    });
  } catch (error) {
    adminsList.textContent =
      "Could not load accounts. Check Firestore rules.";
    console.error("Load administrators error:", error);
  }
}

promoteOwnerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = promoteOwnerEmail.value.trim().toLowerCase();
  if (!email) return;

  promoteOwnerButton.disabled = true;
  promoteOwnerMessage.textContent = "Looking up the registered account...";

  try {
    const snapshot = await getDocs(collection(db, "admins"));
    const matches = snapshot.docs.filter((item) =>
      String(item.data().email || "").trim().toLowerCase() === email
    );

    if (matches.length !== 1) {
      promoteOwnerMessage.textContent = matches.length === 0
        ? "No registered dealer or administrator profile matches that email."
        : "More than one profile matches that email. Resolve the duplicate profiles before granting access.";
      promoteOwnerMessage.style.color = "#c62828";
      return;
    }

    const account = matches[0];
    const profile = account.data();
    if (String(profile.role || "").trim().toLowerCase() === "owner" && profile.active === true) {
      promoteOwnerMessage.textContent = "This account already has active owner access.";
      promoteOwnerMessage.style.color = "#167a35";
      return;
    }

    const accountName = profile.name || email;
    if (!confirm("Grant full owner access to " + accountName + " (" + email + ")? This allows marketplace-wide account, seller, listing and payment management.")) {
      promoteOwnerMessage.textContent = "Owner promotion cancelled.";
      promoteOwnerMessage.style.color = "#475569";
      return;
    }

    await updateDoc(doc(db, "admins", account.id), {
      role: "owner",
      active: true,
      accountStatus: "active",
      accessUpdatedAt: serverTimestamp(),
      accessUpdatedBy: auth.currentUser.uid
    });

    promoteOwnerMessage.textContent = email + " now has owner access. They should sign out and sign back in.";
    promoteOwnerMessage.style.color = "#167a35";
    promoteOwnerForm.reset();
    await Promise.all([loadAdmins(), loadAccountStats()]);
  } catch (error) {
    console.error("Grant owner access failed:", error);
    promoteOwnerMessage.textContent = "Could not grant owner access: " + (error.code || error.message);
    promoteOwnerMessage.style.color = "#c62828";
  } finally {
    promoteOwnerButton.disabled = false;
  }
});

async function loadSellerApplications() {
  sellerApplicationsMessage.textContent = "Loading seller applications...";
  sellerApplicationsList.replaceChildren();

  try {
    const snapshot = await getDocs(collection(db, "admins"));
    const sellers = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((seller) => String(seller.role || "").toLowerCase() === "dealer")
      .sort((a, b) => {
        const rank = { pending: 0, rejected: 1, suspended: 2, approved: 3 };
        return (rank[a.approvalStatus || "pending"] ?? 4) - (rank[b.approvalStatus || "pending"] ?? 4);
      });

    if (!sellers.length) {
      sellerApplicationsList.textContent = "No self-registered seller applications yet.";
      sellerApplicationsMessage.textContent = "Seller applications updated.";
      return;
    }

    sellers.forEach((seller) => {
      const row = document.createElement("article");
      row.className = "admin-list-item";

      const title = document.createElement("strong");
      title.textContent = seller.name || "Unnamed seller";

      const details = document.createElement("p");
      details.textContent =
        (seller.sellerType === "broker" ? "Independent Sales Representative" : "Showroom Representative") +
        (seller.businessName ? " · " + seller.businessName : "") +
        " · " + (seller.email || "No email");

      const contact = document.createElement("p");
      contact.textContent = "WhatsApp: " + (seller.whatsapp || "Not provided");

      const status = document.createElement("p");
      status.textContent = "Approval: " + (seller.approvalStatus || "pending") +
        " · Account active: " + (seller.active === true ? "Yes" : "No");

      row.append(title, details, contact, status);

      const checklist = document.createElement("div");
      checklist.className = "seller-verification-checklist";
      const verificationChecks = {};
      const addVerificationCheck = (key, label) => {
        const labelElement = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = seller.verificationChecks?.[key] === true;
        verificationChecks[key] = input;
        labelElement.append(input, document.createTextNode(label));
        checklist.appendChild(labelElement);
      };
      addVerificationCheck("identityChecked", "Identity checked");
      addVerificationCheck("phoneConfirmed", "Phone/contact independently confirmed");
      addVerificationCheck("sellerAuthorityChecked", "Permission to market vehicles checked");
      if (seller.sellerType === "dealership") {
        addVerificationCheck("businessDetailsChecked", "Showroom/business details checked");
      }
      const checklistNote = document.createElement("p");
      checklistNote.textContent = "Complete these checks before approval. Do not upload identity documents into this checklist.";
      checklist.appendChild(checklistNote);
      row.appendChild(checklist);

      const actions = document.createElement("div");
      actions.className = "seller-review-actions";

      const makeAction = (label, nextStatus, active) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", async () => {
          if (nextStatus === "approved") {
            const checksPassed = verificationChecks.identityChecked.checked
              && verificationChecks.phoneConfirmed.checked
              && verificationChecks.sellerAuthorityChecked.checked
              && (seller.sellerType !== "dealership" || verificationChecks.businessDetailsChecked.checked);
            if (!checksPassed) {
              sellerApplicationsMessage.textContent = "Complete the required verification checklist before approving this seller.";
              return;
            }
            if (!confirm("Approve " + (seller.name || "this seller") + "? You confirm that you completed the checklist above.")) return;
          }
          if (nextStatus !== "approved" &&
              !confirm(label + " for " + (seller.name || "this seller") + "?")) return;

          button.disabled = true;
          try {
            await updateDoc(doc(db, "admins", seller.id), {
              approvalStatus: nextStatus,
              active,
              verificationStatus: nextStatus === "approved" ? "reviewed" : (seller.verificationStatus || "pending"),
              verificationChecks: {
                identityChecked: verificationChecks.identityChecked.checked,
                phoneConfirmed: verificationChecks.phoneConfirmed.checked,
                sellerAuthorityChecked: verificationChecks.sellerAuthorityChecked.checked,
                businessDetailsChecked: seller.sellerType === "dealership" ? verificationChecks.businessDetailsChecked.checked : false
              },
              reviewedAt: serverTimestamp(),
              reviewedBy: auth.currentUser.uid
            });

            const sellerCars = await getDocs(query(collection(db, "cars"), where("addedBy", "==", seller.id)));
            const listingUpdates = [];
            sellerCars.forEach((carDoc) => {
              const car = carDoc.data();
              if (nextStatus === "approved" && car.listingStatus === "suspended") {
                listingUpdates.push(updateDoc(doc(db, "cars", carDoc.id), { listingStatus: "active" }));
              } else if (nextStatus !== "approved" && car.listingStatus !== "sold") {
                listingUpdates.push(updateDoc(doc(db, "cars", carDoc.id), { listingStatus: "suspended" }));
              }
            });
            await Promise.all(listingUpdates);

            sellerApplicationsMessage.textContent = "Seller status updated to " + nextStatus + ".";

            await Promise.all([loadSellerApplications(), loadAdmins(), loadAccountStats()]);
          } catch (error) {
            console.error("Seller approval update failed:", error);
            sellerApplicationsMessage.textContent = "Could not update seller: " + (error.code || error.message);
          } finally {
            button.disabled = false;
          }
        });
        return button;
      };

      const approvalStatus = seller.approvalStatus || "pending";
      if (approvalStatus === "suspended" || approvalStatus === "rejected") {
        actions.appendChild(makeAction("Approve / Reactivate", "approved", true));
      } else if (approvalStatus !== "approved") {
        actions.appendChild(makeAction("Approve seller", "approved", true));
      }
      if (approvalStatus !== "rejected") {
        actions.appendChild(makeAction("Reject application", "rejected", false));
      }
      if (approvalStatus !== "suspended") {
        actions.appendChild(makeAction("Suspend seller", "suspended", false));
      }

      row.appendChild(actions);
      sellerApplicationsList.appendChild(row);
    });

    sellerApplicationsMessage.textContent = "Loaded " + sellers.length + " seller account(s).";
  } catch (error) {
    console.error("Load seller applications failed:", error);
    sellerApplicationsMessage.textContent = "Could not load applications. Check that the latest Firestore rules have been published.";
  }
}

document.getElementById("logoutButton").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (error) {
    showMessage(ownerMessage, "Could not sign out: " + error.message, true);
  }
});

document.getElementById("refreshButton").addEventListener("click", async () => {
  await Promise.all([loadCarCount(), loadAdmins(), loadAccountStats(), loadSellerApplications(), loadListingPayments()]);
});

document.getElementById("loadAdminsButton").addEventListener("click", loadAdmins);
document.getElementById("loadSellerApplicationsButton").addEventListener("click", loadSellerApplications);
document.getElementById("loadListingPaymentsButton")?.addEventListener("click", loadListingPayments);

async function removePublicSellerCategories() {
  const message = document.getElementById("publicSellerCategoriesMessage");
  if (!message) return;
  if (!confirm("Remove sellerType and sellerBusinessName from existing public vehicle records? Seller categories will remain on internal account profiles. This cannot be undone automatically.")) return;
  message.textContent = "Checking public vehicle records...";
  try {
    const snapshot = await getDocs(collection(db, "cars"));
    const needingCleanup = snapshot.docs.filter((item) => {
      const data = item.data();
      return Object.prototype.hasOwnProperty.call(data, "sellerType")
        || Object.prototype.hasOwnProperty.call(data, "sellerBusinessName");
    });
    if (!needingCleanup.length) {
      message.textContent = "Done. No public vehicle records contain seller category fields.";
      return;
    }
    for (let start = 0; start < needingCleanup.length; start += 400) {
      const batch = writeBatch(db);
      needingCleanup.slice(start, start + 400).forEach((item) => {
        batch.update(item.ref, {
          sellerType: deleteField(),
          sellerBusinessName: deleteField()
        });
      });
      await batch.commit();
    }
    message.textContent = "Removed seller category fields from " + needingCleanup.length + " public listing(s). Internal seller profiles are unchanged.";
  } catch (error) {
    console.error("Remove public seller categories failed:", error);
    message.textContent = "Could not clean up public listings: " + (error.code || error.message) + ". Confirm the latest Firestore rules are published.";
  }
}

document.getElementById("refreshAccountsButton").addEventListener("click", loadAccountStats);

// Recover eligible drafts left behind by the seller approval-status bug.
// This is owner-only, preserves draft data, checks seller approval and skips duplicates.
function draftFingerprint(data) {
  const images = Array.isArray(data.images) ? data.images : [];
  const firstImage = images[0];
  const imageUrl = typeof firstImage === "string" ? firstImage : (firstImage?.url || data.imageUrl || "");
  const createdAt = data.createdAt && typeof data.createdAt.toMillis === "function"
    ? String(data.createdAt.toMillis())
    : "";
  return [
    data.addedBy || "",
    String(data.manufacturer || "").trim().toLowerCase(),
    String(data.model || "").trim().toLowerCase(),
    String(data.year ?? ""),
    String(data.price ?? ""),
    imageUrl,
    createdAt
  ].join("|");
}

async function recoverApprovedDealerDrafts() {
  const button = document.getElementById("recoverApprovedDraftsButton");
  const message = document.getElementById("recoverApprovedDraftsMessage");
  if (!button || !message) return;

  if (!confirm("Recover eligible drafts now? Only drafts belonging to active, approved dealers will be published. Pending/rejected/suspended sellers' drafts will remain private. Existing matching public listings will be skipped.")) return;

  button.disabled = true;
  message.textContent = "Checking dealer approvals, drafts and existing public listings...";
  message.style.color = "#333";

  try {
    const [adminsSnapshot, draftsSnapshot, carsSnapshot] = await Promise.all([
      getDocs(collection(db, "admins")),
      getDocs(collection(db, "dealerDrafts")),
      getDocs(collection(db, "cars"))
    ]);

    const profiles = new Map();
    adminsSnapshot.forEach((item) => profiles.set(item.id, item.data()));

    const publicFingerprints = new Set();
    carsSnapshot.forEach((item) => publicFingerprints.add(draftFingerprint(item.data())));

    const eligible = [];
    let ineligibleSeller = 0;
    let incomplete = 0;
    let duplicate = 0;

    draftsSnapshot.forEach((item) => {
      const draft = item.data();
      const seller = profiles.get(draft.addedBy);
      const approved = seller
        && String(seller.role || "").trim().toLowerCase() === "dealer"
        && seller.active === true
        && String(seller.approvalStatus || "").trim().toLowerCase() === "approved"
        && String(seller.accountStatus || "").trim().toLowerCase() !== "suspended";

      if (!approved) {
        ineligibleSeller += 1;
        return;
      }

      const relationship = String(draft.vehicleRelationship || "").trim().toLowerCase();
      if (
        draft.authorizationConfirmed !== true
        || !["owner", "broker", "authorized_representative"].includes(relationship)
        || !draft.manufacturer
        || !draft.model
        || !draft.price
        || !Array.isArray(draft.images)
        || draft.images.length === 0
      ) {
        incomplete += 1;
        return;
      }

      const fingerprint = draftFingerprint(draft);
      if (publicFingerprints.has(fingerprint)) {
        duplicate += 1;
        return;
      }

      // Reserve the fingerprint immediately so two identical drafts in this recovery
      // run cannot create duplicate public listings.
      publicFingerprints.add(fingerprint);
      eligible.push({ ref: item.ref, data: draft, fingerprint });
    });

    if (!eligible.length) {
      message.textContent = "Recovery complete: 0 drafts published. " +
        ineligibleSeller + " kept private (seller not currently approved and active), " +
        incomplete + " skipped (missing required listing details), " +
        duplicate + " skipped (matching public listing already exists).";
      return;
    }

    let publishedCount = 0;
    for (let start = 0; start < eligible.length; start += 200) {
      const batch = writeBatch(db);
      const group = eligible.slice(start, start + 200);

      group.forEach(({ ref, data }) => {
        const publishedRef = doc(collection(db, "cars"));
        const published = { ...data };
        delete published.id;
        delete published._source;
        published.listingStatus = "pending_payment";
        published.paymentStatus = "pending";
        published.listingFee = feeForPrice(published.price);
        delete published.listingExpiresAt;
        published.publishedAt = serverTimestamp();
        batch.set(publishedRef, published);
        batch.delete(ref);
      });

      await batch.commit();
      publishedCount += group.length;
      message.textContent = "Recovered " + publishedCount + " of " + eligible.length + " eligible drafts...";
    }

    await Promise.all([loadCarCount(), loadSellerApplications()]);
    message.textContent = "Recovery complete: " + publishedCount + " draft(s) published. " +
      ineligibleSeller + " kept private (seller not currently approved and active), " +
      incomplete + " skipped (missing required listing details), " +
      duplicate + " skipped (matching public listing already exists).";
    message.style.color = "#167a35";
  } catch (error) {
    console.error("Recover approved dealer drafts failed:", error);
    message.textContent = "Recovery stopped: " + (error.code || error.message) +
      ". Any earlier completed batch remains saved; run recovery again to process remaining eligible drafts.";
    message.style.color = "#c62828";
  } finally {
    button.disabled = false;
  }
}

document.getElementById("removePublicSellerCategoriesButton")?.addEventListener("click", removePublicSellerCategories);
document.getElementById("recoverApprovedDraftsButton")?.addEventListener("click", recoverApprovedDealerDrafts);

// Wait for Firebase to tell us whether a user is signed in, then check the profile.
onAuthStateChanged(auth, async (user) => {
  try {
    const authorized = await requireOwner(user);

    if (authorized) {
      await Promise.all([loadCarCount(), loadAdmins(), loadAccountStats(), loadSellerApplications(), loadListingPayments()]);
    }
  } catch (error) {
    console.error("Owner dashboard error:", error);
    showMessage(
      ownerMessage,
      "Could not verify your owner account: " + (error.code || error.message) +
        ". Check your connection and Firestore rules.",
      true
    );
  }
});
