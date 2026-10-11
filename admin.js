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
  updateDoc,
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
const whatsappForm = document.getElementById("whatsappForm");
const adminWhatsAppInput = document.getElementById("adminWhatsApp");
const whatsappMessage = document.getElementById("whatsappMessage");

let currentUid = null;
let currentWhatsApp = "";
let currentAdminName = "";

function normalizeKenyanPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) digits = "254" + digits.slice(1);
  else if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) digits = "254" + digits;
  return /^254[17]\d{8}$/.test(digits) ? digits : "";
}
 
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
    currentAdminName = profile.name || user.email || "Kiri Cars seller";
    currentWhatsApp = normalizeKenyanPhone(profile.whatsapp);
    if (currentWhatsApp) adminWhatsAppInput.value = currentWhatsApp;
    setText(adminMessage, "Signed in as " + currentAdminName);
    if (!currentWhatsApp) {
      setText(whatsappMessage, "Save your WhatsApp number before adding vehicles so buyers can contact you directly.", true);
    } else {
      setText(whatsappMessage, "Your WhatsApp contact number is saved.");
    }
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
 
const carPhotosInput = document.getElementById("carPhotos");
const photoPreview = document.getElementById("photoPreview");
const uploadProgress = document.getElementById("uploadProgress");
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CLOUDINARY_CLOUD_NAME = "rfefjzxw";
const CLOUDINARY_UPLOAD_PRESET = "kiri_cars_photos";

function validatePhotos(files) {
  if (!files.length) return "Please select at least one vehicle photo.";
  for (const file of files) {
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) return "Use only JPG, PNG or WebP image files.";
    if (file.size > MAX_PHOTO_BYTES) return file.name + " is larger than 8 MB. Choose a smaller photo.";
  }
  return "";
}

carPhotosInput.addEventListener("change", () => {
  photoPreview.replaceChildren();
  const files = Array.from(carPhotosInput.files || []);
  const validationError = validatePhotos(files);
  if (validationError) {
    setText(uploadProgress, validationError, true);
    return;
  }
  setText(uploadProgress, files.length + (files.length === 1 ? " photo selected." : " photos selected."));
  files.forEach((file) => {
    const figure = document.createElement("figure");
    figure.className = "photo-preview-item";
    const image = document.createElement("img");
    image.alt = file.name;
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.onload = () => URL.revokeObjectURL(objectUrl);
    const caption = document.createElement("figcaption");
    caption.textContent = file.name;
    figure.append(image, caption);
    photoPreview.appendChild(figure);
  });
});

async function uploadPhoto(file, index, total) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", "kiri-cars");
  setText(uploadProgress, "Uploading photo " + index + " of " + total + ": " + file.name);

  const response = await fetch(
    "https://api.cloudinary.com/v1_1/" + CLOUDINARY_CLOUD_NAME + "/image/upload",
    { method: "POST", body: formData }
  );
  const result = await response.json();
  if (!response.ok || !result.secure_url) {
    console.error("Cloudinary upload failed:", result);
    throw new Error(result.error?.message || "Cloudinary could not upload " + file.name);
  }
  return { url: result.secure_url, publicId: result.public_id || "" };
}

whatsappForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUid) return;

  const phone = normalizeKenyanPhone(adminWhatsAppInput.value);
  if (!phone) {
    setText(whatsappMessage, "Enter a valid Kenyan mobile number, e.g. 0712345678 or 254712345678.", true);
    return;
  }

  const saveButton = document.getElementById("saveWhatsAppButton");
  saveButton.disabled = true;
  try {
    await updateDoc(doc(db, "admins", currentUid), { whatsapp: phone });
    currentWhatsApp = phone;
    adminWhatsAppInput.value = phone;
    setText(whatsappMessage, "WhatsApp number saved. Buyers can now contact you directly.");
    await loadMyCars();
  } catch (error) {
    console.error("Save WhatsApp number failed:", error);
    setText(whatsappMessage, "Could not save your number: " + (error.code || error.message), true);
  } finally {
    saveButton.disabled = false;
  }
});

carForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUid) return;
  if (!currentWhatsApp) {
    setText(formMessage, "Please save your WhatsApp number above before adding a vehicle.", true);
    whatsappForm.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const selectedPhotos = Array.from(carPhotosInput.files || []);
  const photoError = validatePhotos(selectedPhotos);
  if (photoError) {
    setText(formMessage, photoError, true);
    return;
  }

  addCarButton.disabled = true;
  carPhotosInput.disabled = true;
  setText(formMessage, "Preparing vehicle photos...");
  try {
    const images = [];
    for (let i = 0; i < selectedPhotos.length; i += 1) {
      images.push(await uploadPhoto(selectedPhotos[i], i + 1, selectedPhotos.length));
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
      images,
      imageUrl: images[0].url,
      addedBy: currentUid,
      sellerWhatsApp: currentWhatsApp,
      sellerName: currentAdminName,
      createdAt: serverTimestamp()
    };

    setText(uploadProgress, "Photos uploaded. Saving vehicle details...");
    await addDoc(collection(db, "cars"), car);
    carForm.reset();
    photoPreview.replaceChildren();
    setText(uploadProgress, "");
    setText(formMessage, "Vehicle added successfully with " + images.length + (images.length === 1 ? " photo." : " photos."));
    await loadMyCars();
  } catch (error) {
    console.error("Add vehicle failed:", error);
    setText(formMessage, "Could not add vehicle: " + (error.code || error.message), true);
    setText(uploadProgress, "If photos uploaded before the error, they may remain in Cloudinary and need cleanup.", true);
  } finally {
    addCarButton.disabled = false;
    carPhotosInput.disabled = false;
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

    // Backfill seller contact on this admin's older listings once their number is saved.
    if (currentWhatsApp) {
      for (const car of cars) {
        if (!car.sellerWhatsApp) {
          try {
            await updateDoc(doc(db, "cars", car.id), {
              sellerWhatsApp: currentWhatsApp,
              sellerName: currentAdminName
            });
            car.sellerWhatsApp = currentWhatsApp;
            car.sellerName = currentAdminName;
          } catch (backfillError) {
            console.warn("Could not update seller contact on listing " + car.id, backfillError);
          }
        }
      }
    }
 
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
 
  const photoUrls = Array.isArray(car.images) ? car.images.map((item) => item?.url).filter(Boolean) : [];
  const firstPhoto = photoUrls[0] || car.imageUrl;
  if (firstPhoto) {
    const image = document.createElement("img");
    image.src = firstPhoto;
    image.alt = title.textContent;
    image.loading = "lazy";
    image.className = "admin-car-photo";
    card.appendChild(image);
  }
  if (photoUrls.length > 1) {
    const photoNote = document.createElement("p");
    photoNote.textContent = photoUrls.length + " photos uploaded";
    card.appendChild(photoNote);
  }

  const lifecycle = document.createElement("p");
  lifecycle.className = "listing-lifecycle";
  if (car.listingStatus === "sold") {
    lifecycle.textContent = "SOLD — marked for removal after 72 hours";
    lifecycle.classList.add("sold-label");
  } else if (car.listingExpiresAt?.toMillis && car.listingExpiresAt.toMillis() <= Date.now()) {
    lifecycle.textContent = "EXPIRED — hidden from public listings until renewed";
    lifecycle.classList.add("expired-label");
  } else {
    lifecycle.textContent = "Listing status: Active";
  }

  card.append(title, details, lifecycle);

  if (car.listingStatus !== "sold") {
    const soldButton = document.createElement("button");
    soldButton.type = "button";
    soldButton.textContent = "Mark as Sold";
    soldButton.addEventListener("click", () => markCarSold(car, soldButton));
    card.appendChild(soldButton);
  }

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Delete";
  removeButton.addEventListener("click", () => deleteCar(car, removeButton));
  card.appendChild(removeButton);
  return card;
}
 
async function markCarSold(car, button) {
  if (car.addedBy !== currentUid) {
    alert("You can only mark vehicles you added as sold.");
    return;
  }
  if (car.listingStatus === "sold") return;
  if (!confirm("Mark " + car.manufacturer + " " + car.model + " as sold? It will remain publicly visible with a SOLD label for 72 hours.")) return;

  button.disabled = true;
  try {
    await updateDoc(doc(db, "cars", car.id), {
      listingStatus: "sold",
      soldAt: serverTimestamp()
    });
    await loadMyCars();
  } catch (error) {
    console.error("Mark as sold failed:", error);
    alert("Could not mark this vehicle as sold: " + (error.code || error.message));
    button.disabled = false;
  }
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
 
