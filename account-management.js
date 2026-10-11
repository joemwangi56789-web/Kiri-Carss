import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const buyersBox = document.getElementById("buyerAccountsList");
const adminsBox = document.getElementById("adminsList");
const message = document.getElementById("accountManagementMessage");

function say(text, error = false) {
  if (message) {
    message.textContent = text;
    message.style.color = error ? "#b42318" : "#167a35";
  }
}

async function ownerOnly(user) {
  if (!user) {
    window.location.replace("login.html");
    return false;
  }
  const snap = await getDoc(doc(db, "admins", user.uid));
  const p = snap.exists() ? snap.data() : null;
  if (!p || p.active !== true || String(p.role || "").toLowerCase() !== "owner") {
    await signOut(auth);
    window.location.replace("login.html");
    return false;
  }
  return true;
}

function button(row, label, handler, danger = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (danger) b.style.backgroundColor = "#b42318";
  b.addEventListener("click", handler);
  row.appendChild(b);
}

async function change(collectionName, account, active) {
  if (collectionName === "admins" && String(account.role || "").toLowerCase() === "owner") {
    say("The owner account is protected.", true);
    return;
  }
  if (!confirm((active ? "Reactivate " : "Suspend ") + (account.name || account.email || "this account") + "?")) return;
  try {
    await updateDoc(doc(db, collectionName, account.id), {
      active,
      accountStatus: active ? "active" : "suspended",
      accessUpdatedAt: serverTimestamp(),
      accessUpdatedBy: auth.currentUser.uid
    });
    say("Account access updated.");
    await Promise.all([loadBuyers(), loadAdmins()]);
  } catch (e) {
    say("Could not update account (" + (e.code || e.message) + "). Firestore rules may need updating.", true);
  }
}

async function loadBuyers() {
  buyersBox.textContent = "Loading buyers...";
  try {
    const snap = await getDocs(collection(db, "buyers"));
    buyersBox.replaceChildren();
    if (snap.empty) {
      buyersBox.textContent = "No buyer accounts found.";
      return;
    }
    snap.docs.forEach((d) => {
      const a = { id: d.id, ...d.data() };
      const active = a.active !== false;
      const row = document.createElement("div");
      row.className = "admin-list-item";
      const title = document.createElement("strong");
      title.textContent = a.name || "Unnamed buyer";
      const email = document.createElement("p");
      email.textContent = a.email || "No email recorded";
      const status = document.createElement("p");
      status.textContent = "Buyer · " + (active ? "Active" : "Suspended");
      row.append(title, email, status);
      button(row, active ? "Suspend Buyer" : "Reactivate Buyer", () => change("buyers", a, !active), active);
      buyersBox.appendChild(row);
    });
    say("Loaded " + snap.size + " buyers.");
  } catch (e) {
    buyersBox.textContent = "Could not load buyer accounts.";
    say("Buyer list error: " + (e.code || e.message), true);
  }
}

async function loadAdmins() {
  adminsBox.textContent = "Loading admin and dealer accounts...";
  try {
    const snap = await getDocs(collection(db, "admins"));
    adminsBox.replaceChildren();
    const accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => ["owner", "admin", "dealer"].includes(String(a.role || "").toLowerCase()));
    if (!accounts.length) {
      adminsBox.textContent = "No admin or dealer accounts found.";
      return;
    }
    accounts.forEach((a) => {
      const active = a.active === true;
      const row = document.createElement("div");
      row.className = "admin-list-item";
      const title = document.createElement("strong");
      title.textContent = a.name || "Unnamed account";
      const email = document.createElement("p");
      email.textContent = a.email || "No email recorded";
      const status = document.createElement("p");
      status.textContent = String(a.role).toUpperCase() + " · " + (active ? "Active" : "Suspended / inactive");
      row.append(title, email, status);
      if (String(a.role).toLowerCase() === "owner") {
        const protectedNote = document.createElement("p");
        protectedNote.textContent = "Owner account — protected";
        row.appendChild(protectedNote);
      } else {
        button(row, active ? "Suspend Account" : "Reactivate Account", () => change("admins", a, !active), active);
      }
      adminsBox.appendChild(row);
    });
  } catch (e) {
    adminsBox.textContent = "Could not load administrator and dealer accounts.";
    say("Account list error: " + (e.code || e.message), true);
  }
}

document.getElementById("loadBuyerAccountsButton")?.addEventListener("click", loadBuyers);
document.getElementById("loadAdminsButton")?.addEventListener("click", loadAdmins);
document.getElementById("loadAdminsButtonTop")?.addEventListener("click", loadAdmins);

onAuthStateChanged(auth, async (user) => {
  try {
    if (await ownerOnly(user)) await Promise.all([loadBuyers(), loadAdmins()]);
  } catch (e) {
    say("Could not verify owner access: " + (e.code || e.message), true);
  }
});
