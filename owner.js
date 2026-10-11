import { app, auth, db } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  initializeApp,
  deleteApp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const ownerMessage = document.getElementById("ownerMessage");
const adminForm = document.getElementById("adminForm");
const adminMessage = document.getElementById("adminMessage");
const createAdminButton = document.getElementById("createAdminButton");
const carCount = document.getElementById("carCount");
const adminsList = document.getElementById("adminsList");
const totalBuyerAccounts = document.getElementById("totalBuyerAccounts");
const totalDealerAccounts = document.getElementById("totalDealerAccounts");
const activeDealerAccounts = document.getElementById("activeDealerAccounts");
const inactiveDealerAccounts = document.getElementById("inactiveDealerAccounts");
const accountStatsMessage = document.getElementById("accountStatsMessage");
const recentAccountsList = document.getElementById("recentAccountsList");

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
      if (role !== "admin") return;
      dealers.push({
        name: data.name || "Unnamed dealer",
        email: data.email || "No email recorded",
        type: "Dealer",
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

adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("adminName").value.trim();
  const email = document.getElementById("adminEmail").value.trim();
  const whatsapp = normalizeKenyanPhone(document.getElementById("adminWhatsApp").value);
  const password = document.getElementById("adminPassword").value;

  if (!whatsapp) {
    showMessage(adminMessage, "Enter a valid Kenyan mobile number, e.g. 0712345678 or 254712345678.", true);
    return;
  }

  createAdminButton.disabled = true;
  createAdminButton.textContent = "Creating account...";
  showMessage(adminMessage, "Creating administrator...", false);

  let secondaryApp;

  try {
    const owner = auth.currentUser;

    if (!owner) {
      throw new Error("Your owner session has expired. Sign in again.");
    }

    const ownerSnap = await getDoc(doc(db, "admins", owner.uid));

    if (
      !ownerSnap.exists() ||
      ownerSnap.data().active !== true ||
      String(ownerSnap.data().role || "").trim().toLowerCase() !== "owner"
    ) {
      throw new Error("Owner permission could not be verified.");
    }

    secondaryApp = initializeApp(
      app.options,
      "KiriCarsAdminCreator"
    );

    const secondaryAuth = getAuth(secondaryApp);

    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      password
    );

    const newAdmin = credential.user;

    await setDoc(doc(db, "admins", newAdmin.uid), {
      name: name,
      email: email,
      role: "admin",
      active: true,
      whatsapp: whatsapp,
      createdAt: serverTimestamp(),
      createdBy: owner.uid
    });

    await signOut(secondaryAuth);

    showMessage(
      adminMessage,
      "Administrator created successfully. They can now sign in.",
      false
    );

    adminForm.reset();
    await loadAdmins();

  } catch (error) {
    console.error("Create administrator error:", error);

    let text = error.message || "Could not create administrator.";

    if (error.code === "auth/email-already-in-use") {
      text = "That email already has a Firebase Authentication account.";
    } else if (error.code === "auth/weak-password") {
      text = "Choose a stronger password with at least 6 characters.";
    } else if (
      error.code === "permission-denied" ||
      error.code === "firestore/permission-denied"
    ) {
      text =
        "Firestore denied this operation. The account may have been created " +
        "in Authentication, but its administrator profile may not have been saved. " +
        "Check Firebase Authentication and Firestore before retrying.";
    }

    showMessage(adminMessage, text, true);

  } finally {
    if (secondaryApp) {
      try {
        await deleteApp(secondaryApp);
      } catch (error) {
        console.warn("Secondary app cleanup failed:", error);
      }
    }

    createAdminButton.disabled = false;
    createAdminButton.textContent = "Create Administrator";
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (error) {
    showMessage(ownerMessage, "Could not sign out: " + error.message, true);
  }
});

document.getElementById("refreshButton").addEventListener("click", async () => {
  await Promise.all([loadCarCount(), loadAdmins(), loadAccountStats()]);
});

document.getElementById("loadAdminsButton").addEventListener("click", loadAdmins);
document.getElementById("refreshAccountsButton").addEventListener("click", loadAccountStats);

// Wait for Firebase to tell us whether a user is signed in, then check the profile.
onAuthStateChanged(auth, async (user) => {
  try {
    const authorized = await requireOwner(user);

    if (authorized) {
      await Promise.all([loadCarCount(), loadAdmins(), loadAccountStats()]);
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
