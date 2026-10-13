import { app, auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";

const functions = getFunctions(app);
const createSavedSearch = httpsCallable(functions, "createSavedSearch");
const verifyWhatsAppAlert = httpsCallable(functions, "verifyWhatsAppAlert");
const claimGuestSearches = httpsCallable(functions, "claimGuestSearches");
const form = document.getElementById("savedSearchForm");
const message = document.getElementById("savedSearchMessage");
const saveButton = document.getElementById("saveSearchButton");
const guestFields = document.getElementById("guestContactFields");
const accountPanel = document.getElementById("accountSearchesPanel");
const accountList = document.getElementById("accountSearchesList");
const whatsappForm = document.getElementById("whatsappVerificationForm");
const claimButton = document.getElementById("claimGuestSearchesButton");
let currentUser = null;
let pendingRequestId = sessionStorage.getItem("kiriPendingAlertId") || "";

function setMessage(text, isError = false) {
  message.textContent = text || "";
  message.style.color = isError ? "#b42318" : "#16864a";
}
function text(id) { return document.getElementById(id).value.trim(); }
function searchFilters() {
  const year = new URLSearchParams(window.location.search).get("year");
  return {
    keyword: text("keyword"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    carType: document.getElementById("carType").value,
    minYear: text("minYear") || year || null,
    maxYear: text("maxYear") || year || null,
    minPrice: text("minPrice") || null,
    maxPrice: text("maxPrice") || null,
    condition: document.getElementById("condition").value,
    location: text("location")
  };
}
function displayFilters(filters) {
  const parts = [];
  if (filters.keyword) parts.push("Keyword: " + filters.keyword);
  if (filters.manufacturer) parts.push(filters.manufacturer);
  if (filters.model) parts.push(filters.model);
  if (filters.carType) parts.push(filters.carType);
  if (filters.minYear || filters.maxYear) parts.push("Year " + (filters.minYear || "any") + "–" + (filters.maxYear || "any"));
  if (filters.minPrice != null || filters.maxPrice != null) parts.push("KSh " + (filters.minPrice == null ? "0" : Number(filters.minPrice).toLocaleString("en-KE")) + "–" + (filters.maxPrice == null ? "no maximum" : Number(filters.maxPrice).toLocaleString("en-KE")));
  if (filters.condition) parts.push(filters.condition);
  if (filters.location) parts.push("Location: " + filters.location);
  return parts.join(" · ") || "Vehicle search";
}
function dateText(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-KE");
}
async function loadAccountSearches() {
  if (!currentUser) return;
  accountList.textContent = "Loading saved searches...";
  try {
    const results = await getDocs(query(collection(db, "savedSearches"), where("ownerUid", "==", currentUser.uid)));
    accountList.replaceChildren();
    if (results.empty) {
      accountList.textContent = "You have no saved searches yet.";
      return;
    }
    results.docs.forEach((snapshot) => {
      const search = snapshot.data();
      const card = document.createElement("article");
      card.className = "admin-list-item";
      const title = document.createElement("h3");
      title.textContent = displayFilters(search.filters || {});
      const status = document.createElement("p");
      status.textContent = "Status: " + String(search.status || "unknown").replaceAll("_", " ") + " · Created " + dateText(search.createdAt);
      const channels = document.createElement("p");
      channels.textContent = "Channels: " + (search.channels || []).join(", ");
      card.append(title, status, channels);
      const marketingLabel = document.createElement("label");
      marketingLabel.className = "consent-label";
      const marketingToggle = document.createElement("input");
      marketingToggle.type = "checkbox";
      marketingToggle.checked = search.marketingOptIn === true;
      marketingToggle.addEventListener("change", async () => {
        marketingToggle.disabled = true;
        try {
          await updateDoc(doc(db, "savedSearches", snapshot.id), { marketingOptIn: marketingToggle.checked, updatedAt: serverTimestamp(), lastInteractionAt: serverTimestamp() });
        } catch (error) {
          marketingToggle.checked = !marketingToggle.checked;
          setMessage("Could not update promotional email preference: " + (error.code || error.message), true);
        } finally {
          marketingToggle.disabled = false;
        }
      });
      marketingLabel.append(marketingToggle, document.createTextNode(" Opt in to weekly promotional emails (optional)"));
      card.appendChild(marketingLabel);
      const actions = document.createElement("div");
      actions.className = "alert-actions";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = search.status === "paused" ? "Resume Alerts" : "Pause Alerts";
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          const nextStatus = search.status === "paused" ? (search.emailVerified || !search.channels.includes("email")) && (search.whatsappVerified || !search.channels.includes("whatsapp")) ? "active" : "pending_verification" : "paused";
          await updateDoc(doc(db, "savedSearches", snapshot.id), { status: nextStatus, updatedAt: serverTimestamp(), lastInteractionAt: serverTimestamp() });
          await loadAccountSearches();
        } catch (error) {
          setMessage("Could not update this search: " + (error.code || error.message), true);
          toggle.disabled = false;
        }
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "reset-button";
      remove.textContent = "Delete Search";
      remove.addEventListener("click", async () => {
        if (!confirm("Delete this saved search permanently? Pending alerts for it will be cancelled when the worker checks them.")) return;
        remove.disabled = true;
        try {
          await deleteDoc(doc(db, "savedSearches", snapshot.id));
          await loadAccountSearches();
        } catch (error) {
          setMessage("Could not delete this search: " + (error.code || error.message), true);
          remove.disabled = false;
        }
      });
      actions.append(toggle, remove);
      card.appendChild(actions);
      accountList.appendChild(card);
    });
  } catch (error) {
    accountList.textContent = "Could not load saved searches: " + (error.code || error.message);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const channels = [];
  if (document.getElementById("channelEmail").checked) channels.push("email");
  if (document.getElementById("channelWhatsApp").checked) channels.push("whatsapp");
  if (!channels.length) {
    setMessage("Choose email, WhatsApp, or both.", true);
    return;
  }
  if (!currentUser && channels.includes("email") && !text("contactEmail")) {
    setMessage("Enter an email address to receive email alerts.", true);
    return;
  }
  if (channels.includes("whatsapp") && !text("contactWhatsApp")) {
    setMessage("Enter your WhatsApp number.", true);
    return;
  }
  saveButton.disabled = true;
  setMessage("Saving your search and preparing verification...");
  try {
    const result = await createSavedSearch({
      filters: searchFilters(),
      channels,
      email: text("contactEmail"),
      whatsapp: text("contactWhatsApp"),
      marketingOptIn: document.getElementById("marketingOptIn").checked
    });
    pendingRequestId = result.data.id;
    sessionStorage.setItem("kiriPendingAlertId", pendingRequestId);
    setMessage(result.data.message);
    if (result.data.needsWhatsAppVerification) whatsappForm.hidden = false;
    if (currentUser) await loadAccountSearches();
    if (result.data.needsEmailVerification) setMessage("Check your email for the verification link. If you selected WhatsApp too, enter the WhatsApp code below. Both selected channels must be verified before alerts start.");
    if (result.data.status === "active") form.reset();
  } catch (error) {
    console.error("Saved search creation failed:", error);
    setMessage(error.message || "Could not save this search. Please try again.", true);
  } finally {
    saveButton.disabled = false;
  }
});

whatsappForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingRequestId) {
    setMessage("Create a saved search before entering a verification code.", true);
    return;
  }
  const button = whatsappForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const result = await verifyWhatsAppAlert({ id: pendingRequestId, code: document.getElementById("whatsappCode").value.trim() });
    setMessage(result.data.message);
    whatsappForm.hidden = true;
    document.getElementById("whatsappCode").value = "";
    sessionStorage.removeItem("kiriPendingAlertId");
    pendingRequestId = "";
    if (currentUser) await loadAccountSearches();
  } catch (error) {
    setMessage(error.message || "Could not verify that number.", true);
  } finally {
    button.disabled = false;
  }
});

claimButton.addEventListener("click", async () => {
  claimButton.disabled = true;
  const claimMessage = document.getElementById("claimSearchesMessage");
  try {
    const result = await claimGuestSearches({});
    claimMessage.textContent = result.data.message;
    await loadAccountSearches();
  } catch (error) {
    claimMessage.textContent = error.message || "Could not transfer guest searches.";
    claimMessage.style.color = "#b42318";
  } finally {
    claimButton.disabled = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  guestFields.hidden = Boolean(user);
  if (user) {
    document.getElementById("contactEmail").value = user.email || "";
    document.getElementById("contactEmail").disabled = true;
    document.getElementById("channelEmail").checked = true;
    document.getElementById("channelEmail").disabled = !user.emailVerified;
    document.getElementById("channelEmail").title = user.emailVerified ? "" : "Verify your account email before selecting email alerts.";
    accountPanel.hidden = false;
    if (!user.emailVerified) setMessage("Your account email is not verified. Verify it before selecting email alerts.", true);
    await loadAccountSearches();
  } else {
    document.getElementById("contactEmail").disabled = false;
    document.getElementById("channelEmail").disabled = false;
    accountPanel.hidden = true;
  }
});

if (pendingRequestId) whatsappForm.hidden = false;

const params = new URLSearchParams(window.location.search);
if (params.has("search")) document.getElementById("keyword").value = params.get("search") || "";
if (params.has("manufacturer")) document.getElementById("manufacturer").value = params.get("manufacturer") || "";
if (params.has("type")) document.getElementById("carType").value = params.get("type") || "";
if (params.has("year")) {
  document.getElementById("minYear").value = params.get("year") || "";
  document.getElementById("maxYear").value = params.get("year") || "";
}
if (params.has("status")) document.getElementById("condition").value = params.get("status") || "";
if (params.has("minPrice")) document.getElementById("minPrice").value = params.get("minPrice") || "";
if (params.has("maxPrice")) document.getElementById("maxPrice").value = params.get("maxPrice") || "";
