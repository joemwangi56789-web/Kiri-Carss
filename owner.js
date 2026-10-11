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
  query,
  where,
  serverTimestamp
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
        type: data.sellerType === "broker" ? "Independent broker" :
          (data.sellerType === "dealership" ? "Dealership" : "Dealer"),
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
        (seller.sellerType === "broker" ? "Independent broker" : "Dealership") +
        (seller.businessName ? " · " + seller.businessName : "") +
        " · " + (seller.email || "No email");

      const contact = document.createElement("p");
      contact.textContent = "WhatsApp: " + (seller.whatsapp || "Not provided");

      const status = document.createElement("p");
      status.textContent = "Approval: " + (seller.approvalStatus || "pending") +
        " · Account active: " + (seller.active === true ? "Yes" : "No");

      row.append(title, details, contact, status);

      const actions = document.createElement("div");
      actions.className = "seller-review-actions";

      const makeAction = (label, nextStatus, active) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", async () => {
          if (nextStatus === "approved" &&
              !confirm("Approve " + (seller.name || "this seller") + "? Confirm you have completed the required identity, contact and seller-authority checks.")) return;
          if (nextStatus !== "approved" &&
              !confirm(label + " for " + (seller.name || "this seller") + "?")) return;

          button.disabled = true;
          try {
            await updateDoc(doc(db, "admins", seller.id), {
              approvalStatus: nextStatus,
              active,
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
  await Promise.all([loadCarCount(), loadAdmins(), loadAccountStats(), loadSellerApplications()]);
});

document.getElementById("loadAdminsButton").addEventListener("click", loadAdmins);
document.getElementById("loadSellerApplicationsButton").addEventListener("click", loadSellerApplications);
document.getElementById("refreshAccountsButton").addEventListener("click", loadAccountStats);

// Wait for Firebase to tell us whether a user is signed in, then check the profile.
onAuthStateChanged(auth, async (user) => {
  try {
    const authorized = await requireOwner(user);

    if (authorized) {
      await Promise.all([loadCarCount(), loadAdmins(), loadAccountStats(), loadSellerApplications()]);
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
