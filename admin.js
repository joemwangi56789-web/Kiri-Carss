import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  doc,
  getDoc,
  addDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
 
const adminMessage = document.getElementById("adminMessage");
const formMessage = document.getElementById("formMessage");
const carForm = document.getElementById("carForm");
const addCarButton = document.getElementById("addCarButton");
const reloadCarsButton = document.getElementById("reloadCarsButton");
const logoutButton = document.getElementById("logoutButton");
const myCars = document.getElementById("myCars");
 
let currentUid = null;
 
function setText(el, text, isError = false) {
  el.textContent = text;
  el.style.color = isError ? "#c62828" : "#167a35";
}
 
function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}
 
function goToLogin() {
  window.location.replace("login.html");
}
 
// Wait for Firebase to restore the saved session before checking anything.
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    goToLogin();
    return;
  }
 
  try {
    const snap = await getDoc(doc(db, "admins", user.uid));
    const profile = snap.exists() ? snap.data() : null;
 
    if (!profile || profile.active !== true) {
      await signOut(auth);
      goToLogin();
      return;
    }
 
    const role = normalizeRole(profile.role);
 
    if (role === "owner") {
      window.location.replace("owner.html");
      return;
    }
 
    if (role !== "admin") {
      await signOut(auth);
      goToLogin();
      return;
    }
 
    currentUid = user.uid;
    setText(adminMessage, "Signed in as " + (profile.name || user.email));
    await loadMyCars();
  } catch (error) {
    console.error("Admin check failed:", error);
    setText(adminMessage, "Could not verify your account: " + (error.code || error.message), true);
  }
});
 
function readNumber(id) {
  const raw = document.getElementById(id).value.trim();
  return raw === "" ? null : Number(raw);
}
 
function safeHttpsUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch (e) {
    return null;
  }
}
 
carForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUid) return;
 
  const imageUrl = safeHttpsUrl(document.getElementById("imageUrl").value.trim());
  if (imageUrl === null) {
    setText(formMessage, "Image URL must start with https://", true);
    return;
  }
 
  const car = {
    manufacturer: document.getElementById("manufacturer").value.trim(),
    carType: document.getElementById("carType").value,
    model: document.getElementById("model").value.trim(),
    year: readNumber("year"),
    price: readNumber("price"),
    status: document.getElementById("status").value,
    mileage: readNumber("mileage"),
    fuel: document.getElementById("fuel").value,
    transmission: document.getElementById("transmission").value,
    description: document.getElementById("description").value.trim(),
    imageUrl: imageUrl,
    addedBy: currentUid,
    createdAt: serverTimestamp()
  };
 
  addCarButton.disabled = true;
  setText(formMessage, "Saving vehicle...");
 
  try {
    await addDoc(collection(db, "cars"), car);
    carForm.reset();
    setText(formMessage, "Vehicle added.");
    await loadMyCars();
  } catch (error) {
    console.error("Add vehicle failed:", error);
    setText(formMessage, "Could not add vehicle: " + (error.code || error.message), true);
  } finally {
    addCarButton.disabled = false;
  }
});
 
async function loadMyCars() {
  if (!currentUid) return;
  myCars.textContent = "Loading your vehicles...";
 
  try {
    const q = query(collection(db, "cars"), where("addedBy", "==", currentUid));
    const result = await getDocs(q);
 
    const cars = result.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Sort in the browser so no Firestore composite index is needed.
    cars.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
 
    myCars.textContent = "";
 
    if (cars.length === 0) {
      myCars.textContent = "You have not added any vehicles yet.";
      return;
    }
 
    cars.forEach((car) => myCars.appendChild(renderCar(car)));
  } catch (error) {
    console.error("Load vehicles failed:", error);
    myCars.textContent = "Could not load vehicles: " + (error.code || error.message);
  }
}
 
function renderCar(car) {
  const card = document.createElement("div");
  card.className = "dashboard-card";
 
  const title = document.createElement("h4");
  title.textContent = [car.year, car.manufacturer, car.model].filter(Boolean).join(" ");
 
  const details = document.createElement("p");
  const price = typeof car.price === "number" ? "KSh " + car.price.toLocaleString() : "Price not set";
  details.textContent = [car.carType, car.status, car.fuel, car.transmission, price]
    .filter(Boolean)
    .join(" · ");
 
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Delete";
  removeButton.addEventListener("click", () => deleteCar(car, removeButton));
 
  card.append(title, details, removeButton);
  return card;
}
 
async function deleteCar(car, button) {
  if (car.addedBy !== currentUid) {
    alert("You can only delete vehicles you added.");
    return;
  }
  if (!confirm("Delete " + car.manufacturer + " " + car.model + "?")) return;
 
  button.disabled = true;
  try {
    await deleteDoc(doc(db, "cars", car.id));
    await loadMyCars();
  } catch (error) {
    console.error("Delete failed:", error);
    alert("Could not delete: " + (error.code || error.message));
    button.disabled = false;
  }
}
 
reloadCarsButton.addEventListener("click", loadMyCars);
 
logoutButton.addEventListener("click", async () => {
  await signOut(auth);
  goToLogin();
});
 
