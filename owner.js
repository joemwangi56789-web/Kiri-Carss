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

function showMessage(element, text, isError = false) {
  element.textContent = text;
  element.style.color = isError ? "#c62828" : "#167a35";
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

      row.append(name, email, role);
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
  const password = document.getElementById("adminPassword").value;

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
  await loadCarCount();
  await loadAdmins();
});

document.getElementById("loadAdminsButton").addEventListener("click", loadAdmins);

// Wait for Firebase to tell us whether a user is signed in, then check the profile.
onAuthStateChanged(auth, async (user) => {
  try {
    const authorized = await requireOwner(user);

    if (authorized) {
      await loadCarCount();
      await loadAdmins();
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
