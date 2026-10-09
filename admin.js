
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const adminMessage = document.getElementById("adminMessage");
const formMessage = document.getElementById("formMessage");
const carForm = document.getElementById("carForm");
const addCarButton = document.getElementById("addCarButton");
const myCars = document.getElementById("myCars");

let currentUser = null;
let authorized = false;
let loadingCars = false;

function showMessage(element, text, isError = false) {
  element.textContent = text;
  element.style.color = isError ? "#c62828" : "#167a35";
}

function safeImageUrl(value) {
  if (!value) return "";

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

async function verifyAdmin(user) {
  const profileSnap = await getDoc(doc(db, "admins", user.uid));

  if (!profileSnap.exists()) {
    throw new Error("Your account profile was not found in Firestore.");
  }

  const profile = profileSnap.data();
  const role = String(profile.role || "").trim().toLowerCase();

  if (profile.active !== true || role !== "admin") {
    throw new Error("This dashboard is only available to active administrators.");
  }

  return profile;
}

async function loadMyCars() {
  if (!currentUser || !authorized || loadingCars) return;

  loadingCars = true;
  myCars.textContent = "Loading your vehicles...";

  try {
    const carsQuery = query(
      collection(db, "cars"),
      where("addedBy", "==", currentUser.uid)
    );

    const snapshot = await getDocs(carsQuery);
    myCars.replaceChildren();

    if (snapshot.empty) {
      myCars.textContent = "You have not added any vehicles yet.";
      return;
    }

    snapshot.forEach((carDoc) => {
      const car = carDoc.data();

      const card = document.createElement("article");
      card.className = "vehicle-card";

      const title = document.createElement("h4");
      title.textContent =
        (car.manufacturer || "") + " " + (car.model || "Vehicle");

      const details = document.createElement("p");
      details.textContent =
        "Year: " + (car.year ?? "N/A") +
        " | Price: KSh " + Number(car.price || 0).toLocaleString("en-KE");

      const status = document.createElement("p");
      status.textContent =
        "Status: " + (car.status || "N/A") +
        " | Fuel: " + (car.fuel || "N/A");

      card.append(title, details, status);

      const imageUrl = safeImageUrl(car.imageUrl);

      if (imageUrl) {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = title.textContent;
        image.loading = "lazy";
        image.style.maxWidth = "100%";
        image.onerror = () => image.remove();
        card.prepend(image);
      }

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Remove Listing";

      deleteButton.addEventListener("click", async () => {
        const confirmed = window.confirm(
          "Are you sure you want to remove " + title.textContent + "?"
        );

        if (!confirmed) return;

        deleteButton.disabled = true;

        try {
          const freshUser = auth.currentUser;

          if (!freshUser || freshUser.uid !== currentUser.uid) {
            throw new Error("Your session has expired. Please sign in again.");
          }

          const latestDoc = await getDoc(doc(db, "cars", carDoc.id));

          if (!latestDoc.exists()) {
            showMessage(formMessage, "This vehicle has already been removed.");
            await loadMyCars();
            return;
          }

          if (latestDoc.data().addedBy !== freshUser.uid) {
            throw new Error("You can only remove vehicles you added.");
          }

          await deleteDoc(doc(db, "cars", carDoc.id));

          showMessage(formMessage, "Vehicle listing removed successfully.");
          await loadMyCars();

        } catch (error) {
          showMessage(formMessage, error.message, true);
        } finally {
          deleteButton.disabled = false;
        }
      });

      card.appendChild(deleteButton);
      myCars.appendChild(card);
    });

  } catch (error) {
    console.error("Load vehicles error:", error);
    myCars.textContent =
      "Could not load your vehicles. Check your internet connection and Firestore rules.";
  } finally {
    loadingCars = false;
  }
}

carForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || !authorized) {
    showMessage(formMessage, "Your administrator session is not authorized.", true);
    return;
  }

  const manufacturer = document.getElementById("manufacturer").value.trim();
  const carType = document.getElementById("carType").value;
  const model = document.getElementById("model").value.trim();
  const year = Number(document.getElementById("year").value);
  const price = Number(document.getElementById("price").value);
  const status = document.getElementById("status").value;
  const mileageInput = document.getElementById("mileage").value;
  const mileage = mileageInput === "" ? null : Number(mileageInput);
  const fuel = document.getElementById("fuel").value;
  const transmission = document.getElementById("transmission").value;
  const description = document.getElementById("description").value.trim();
  const imageUrlInput = document.getElementById("imageUrl").value.trim();

  if (
    !manufacturer || !carType || !model || !year ||
    !price || !status || !fuel || !transmission
  ) {
    showMessage(formMessage, "Please complete all required fields.", true);
    return;
  }

  if (year < 1950 || year > 2035 || price <= 0) {
    showMessage(formMessage, "Check the vehicle year and price.", true);
    return;
  }

  if (mileage !== null && (!Number.isFinite(mileage) || mileage < 0)) {
    showMessage(formMessage, "Enter a valid mileage.", true);
    return;
  }

  const imageUrl = safeImageUrl(imageUrlInput);

  if (imageUrlInput && !imageUrl) {
    showMessage(formMessage, "Use a valid HTTP or HTTPS image URL.", true);
    return;
  }

  addCarButton.disabled = true;
  addCarButton.textContent = "Saving vehicle...";

  try {
    const freshUser = auth.currentUser;

    if (!freshUser || freshUser.uid !== currentUser.uid) {
      throw new Error("Your session has expired. Please sign in again.");
    }

    await addDoc(collection(db, "cars"), {
      manufacturer,
      carType,
      model,
      year,
      price,
      status,
      mileage,
      fuel,
      transmission,
      description,
      imageUrl,
      addedBy: freshUser.uid,
      createdAt: serverTimestamp()
    });

    showMessage(formMessage, "Vehicle added successfully.");
    carForm.reset();
    await loadMyCars();

  } catch (error) {
    console.error("Add vehicle error:", error);

    showMessage(
      formMessage,
      error.code === "permission-denied"
        ? "Firestore denied this listing. Check that your admin profile is active and that your database rules allow admins to add their own vehicles."
        : "Could not save vehicle: " + error.message,
      true
    );
  } finally {
    addCarButton.disabled = false;
    addCarButton.textContent = "Add Vehicle";
  }
});

document.getElementById("reloadCarsButton").addEventListener("click", loadMyCars);

document.getElementById("logoutButton").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (error) {
    showMessage(adminMessage, "Could not sign out: " + error.message, true);
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  authorized = false;

  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const profile = await verifyAdmin(user);

    authorized = true;
    showMessage(
      adminMessage,
      "Welcome, " + (profile.name || user.email) + ".",
      false
    );

    await loadMyCars();

  } catch (error) {
    console.error("Admin authorization error:", error);
    showMessage(adminMessage, error.message, true);

    await signOut(auth);
    window.location.replace("login.html");
  }
});
