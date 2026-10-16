import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut,
  deleteUser
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
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { storage } from "./firebase-config.js";
 
const adminMessage = document.getElementById("adminMessage");
const formMessage = document.getElementById("formMessage");
const carForm = document.getElementById("carForm");
const addCarButton = document.getElementById("addCarButton");
const myCars = document.getElementById("myCars");
const listingSearchInput = document.getElementById("listingSearchInput");
const listingStatusFilter = document.getElementById("listingStatusFilter");
const listingSortSelect = document.getElementById("listingSortSelect");
const listingFilterSummary = document.getElementById("listingFilterSummary");
const whatsappForm = document.getElementById("whatsappForm");
const adminWhatsAppInput = document.getElementById("adminWhatsApp");
const whatsappMessage = document.getElementById("whatsappMessage");
const themeToggle = document.getElementById("themeToggle");
const profileAvatarBtn = document.getElementById("profileAvatarBtn");
const profileAvatarImg = document.getElementById("profileAvatarImg");
const profileDropdown = document.getElementById("profileDropdown");
const profileDropdownMenu = document.getElementById("profileDropdownMenu");
const profileDropdownAvatarImg = document.getElementById("profileDropdownAvatarImg");
const profileDropdownName = document.getElementById("profileDropdownName");
const profileDropdownEmail = document.getElementById("profileDropdownEmail");
const profileDropdownRole = document.getElementById("profileDropdownRole");
const editProfileBtn = document.getElementById("editProfileBtn");
const changePasswordBtn = document.getElementById("changePasswordBtn");
const logoutDropdownBtn = document.getElementById("logoutDropdownBtn");

// Edit profile modal elements
const editProfileModal = document.getElementById("editProfileModal");
const editProfileForm = document.getElementById("editProfileForm");
const editProfileAvatarPreview = document.getElementById("editProfileAvatarPreview");
const editProfileAvatarImg = document.getElementById("editProfileAvatarImg");
const editProfileAvatarInput = document.getElementById("editProfileAvatarInput");
const editProfileName = document.getElementById("editProfileName");
const editProfileEmail = document.getElementById("editProfileEmail");
const editProfileRole = document.getElementById("editProfileRole");
const closeEditProfileModal = document.getElementById("closeEditProfileModal");
const cancelEditProfileBtn = document.getElementById("cancelEditProfileBtn");

let currentUid = null;
let currentWhatsApp = "";
let currentAdminName = "";
let currentRole = "";
let currentProfile = null;
let currentApprovalStatus = "";
let currentCanPublish = false;
let allMyCars = [];

const overviewCountElements = {
  live: document.getElementById("overviewLiveCount"),
  draft: document.getElementById("overviewDraftCount"),
  pending: document.getElementById("overviewPendingCount"),
  sold: document.getElementById("overviewSoldCount"),
  expiring: document.getElementById("overviewExpiringCount")
};

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

function timestampMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return null;
}

function listingCategory(car, now = Date.now()) {
  if (car._source === "dealerDrafts" || car.listingStatus === "draft") return "draft";
  if (car.listingStatus === "sold") return "sold";
  if (
    car.listingStatus === "pending_payment" ||
    (car.paymentStatus && !["paid", "free_trial"].includes(car.paymentStatus))
  ) {
    return "pending";
  }
  if (car.listingStatus === "suspended") return "suspended";

  const expiry = timestampMillis(car.listingExpiresAt);
  if (expiry !== null && expiry <= now) return "expired";
  return "live";
}

function isExpiringSoon(car, now = Date.now()) {
  if (listingCategory(car, now) !== "live") return false;
  const expiry = timestampMillis(car.listingExpiresAt);
  return expiry !== null && expiry > now && expiry <= now + EXPIRING_SOON_MS;
}

function updateListingOverview(cars) {
  const now = Date.now();
  const counts = {
    live: 0,
    draft: 0,
    pending: 0,
    sold: 0,
    expiring: 0
  };

  cars.forEach((car) => {
    const category = listingCategory(car, now);
    if (Object.hasOwn(counts, category)) counts[category] += 1;
    if (isExpiringSoon(car, now)) counts.expiring += 1;
  });

  Object.entries(overviewCountElements).forEach(([category, element]) => {
    if (element) element.textContent = counts[category].toLocaleString("en-KE");
  });
}

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

function displayVehicleStatus(status) {
  const legacyStatuses = {
    used: "Locally Used",
    certified_preowned: "Locally Used",
    new: "Brand New"
  };
  return Object.hasOwn(legacyStatuses, status) ? legacyStatuses[status] : status || "";
}

function listingFeeForPrice(price) {
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
 
function goToLogin() {
  window.location.replace("login.html");
}
 
// Restore the Firebase session, then permit legacy admins and self-registered dealers.
let authInitialized = false;
onAuthStateChanged(auth, async (user) => {
  // Mark that auth state has been determined at least once
  authInitialized = true;
  
  if (!user) {
    goToLogin();
    return;
  }

  // Check for ad blocker blocking Firestore
  const adminMessage = document.getElementById("adminMessage");
  setText(adminMessage, "Checking your account...", false);

  try {
    const snap = await getDoc(doc(db, "admins", user.uid));
    const profile = snap.exists() ? snap.data() : null;
    if (!profile) {
      await signOut(auth);
      goToLogin();
      return;
    }

    const role = normalizeRole(profile.role);
    const approvalStatus = String(profile.approvalStatus || (role === "admin" ? "approved" : "pending")).toLowerCase();

    if (role === "owner") {
      window.location.replace("owner.html");
      return;
    }

    // A suspended account must not regain dashboard access by signing in again.
    // Pending dealers remain able to prepare private drafts unless explicitly suspended.
    const isSuspended = profile.accountStatus === "suspended";
    const inactiveAdmin = role === "admin" && profile.active !== true;
    const inactiveNonPendingDealer =
      role === "dealer" && profile.active !== true && approvalStatus !== "pending";

    if (isSuspended || inactiveAdmin || inactiveNonPendingDealer) {
      await signOut(auth);
      goToLogin();
      return;
    }

    if (role !== "admin" && role !== "dealer") {
      await signOut(auth);
      goToLogin();
      return;
    }

    currentUid = user.uid;
    currentRole = role;
    currentProfile = profile;
    currentApprovalStatus = approvalStatus;
    currentCanPublish = role === "admin" ||
      (role === "dealer" && profile.active === true && approvalStatus === "approved");
    currentAdminName = profile.name || user.email || "Kiri Cars seller";
    currentWhatsApp = normalizeKenyanPhone(profile.whatsapp);
    if (currentWhatsApp) adminWhatsAppInput.value = currentWhatsApp;

    // Load profile avatar if exists
    loadProfileAvatar(profile, user);

    if (role === "dealer" && approvalStatus === "pending") {
      setText(adminMessage, "Your seller application is pending review. You can prepare private draft listings, but buyers cannot see them yet.");
      setText(document.getElementById("listingPermissionNotice"), "Draft mode: listings you save now stay private until your account is approved.");
      addCarButton.textContent = "Save Draft Listing";
    } else if (role === "dealer" && approvalStatus !== "approved") {
      setText(adminMessage, "Your seller account is " + approvalStatus + ". You cannot publish listings. Contact Kiri Cars if you believe this is an error.", true);
      setText(document.getElementById("listingPermissionNotice"), "Listing creation is disabled while your account is " + approvalStatus + ".", true);
      carForm.querySelectorAll("input, select, textarea, button").forEach((element) => { element.disabled = true; });
    } else if (role === "dealer") {
      setText(adminMessage, "Your seller account is approved. You can publish vehicles. Approval does not replace vehicle-by-vehicle checks.");
      setText(document.getElementById("listingPermissionNotice"), "Approved seller: new listings can be published after you confirm your permission to market each vehicle.");
      addCarButton.textContent = "Publish Vehicle";
    } else {
      setText(adminMessage, "Signed in as " + currentAdminName);
      setText(document.getElementById("listingPermissionNotice"), "Before adding a vehicle, confirm your relationship to it and that you have permission to advertise it.");
    }

    if (!currentWhatsApp) {
      setText(whatsappMessage, "Save your WhatsApp number before adding vehicles so buyers can contact you directly.", true);
    } else {
      setText(whatsappMessage, "Your WhatsApp contact number is saved.");
    }
    await loadMyCars();
  } catch (error) {
    console.error("Seller account check failed:", error);
    let errMsg = "Could not verify your account: " + (error.code || error.message);
    // Check if it's likely an ad blocker blocking Firestore
    if (error.message?.includes("blocked") || error.message?.includes("permission") || error.code === "unavailable" || error.code === "permission-denied") {
      errMsg += "\n\n⚠️ This may be caused by an ad blocker or privacy extension blocking Firestore. ";
      errMsg += "Please disable ad blockers for this site and refresh.";
    }
    setText(adminMessage, errMsg, true);
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

// Edit mode state
let editingCarId = null;
let editingCarSource = null;
let originalCarData = null;
let existingImageUrls = [];

function validatePhotos(files) {
  if (!files.length) return "Please select at least one vehicle photo.";
  for (const file of files) {
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) return "Use only JPG, PNG or WebP image files.";
    if (file.size > MAX_PHOTO_BYTES) return file.name + " is larger than 8 MB. Choose a smaller photo.";
  }
  return "";
}

carPhotosInput.addEventListener("change", () => {
  console.log("carPhotosInput change event fired", carPhotosInput.files);
  photoPreview.replaceChildren();
  const files = Array.from(carPhotosInput.files || []);
  console.log("Files selected:", files.map(f => f.name));
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
  console.log("Preview elements added:", photoPreview.children.length);
});

async function uploadPhoto(file, index, total) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", "kiri-cars");
  setText(uploadProgress, "Uploading photo " + index + " of " + total + ": " + file.name);

  let response;
  try {
    response = await fetch(
      "https://api.cloudinary.com/v1_1/" + CLOUDINARY_CLOUD_NAME + "/image/upload",
      { method: "POST", body: formData }
    );
  } catch (networkError) {
    console.error("Cloudinary network error:", networkError);
    throw new Error("Network error: Could not reach Cloudinary. Check internet connection or ad blocker.");
  }
  
  let result;
  try {
    result = await response.json();
  } catch (jsonError) {
    console.error("Cloudinary response parse error:", jsonError);
    throw new Error("Invalid response from Cloudinary upload");
  }
  
  if (!response.ok || !result.secure_url) {
    console.error("Cloudinary upload failed:", result);
    const msg = result.error?.message || "Cloudinary could not upload " + file.name;
    throw new Error(msg);
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

  // Re-read the seller profile before choosing draft vs public listing.
  // A seller may already have this dashboard open when the owner approves them.
  // In that case the in-memory approval status would otherwise remain "pending".
  try {
    const latestProfileSnap = await getDoc(doc(db, "admins", currentUid));
    if (!latestProfileSnap.exists()) {
      setText(formMessage, "Could not verify your seller account. Please sign in again.", true);
      return;
    }

    const latestProfile = latestProfileSnap.data();
    if (latestProfile.accountStatus === "suspended") {
      setText(formMessage, "Your account is suspended. Contact Kiri Cars support.", true);
      return;
    }

    currentProfile = latestProfile;
    currentApprovalStatus = String(
      latestProfile.approvalStatus || (currentRole === "admin" ? "approved" : "pending")
    ).trim().toLowerCase();
    currentCanPublish = (currentRole === "admin" && latestProfile.active === true) ||
      (currentRole === "dealer" && latestProfile.active === true && currentApprovalStatus === "approved");

    if (currentRole === "dealer" && currentApprovalStatus === "approved" && latestProfile.active === true) {
      addCarButton.textContent = "Publish Vehicle";
      setText(adminMessage, "Your seller account is approved. You can publish vehicles.");
      setText(document.getElementById("listingPermissionNotice"), "Approved seller: new listings can be published after you confirm your permission to market each vehicle.");
    } else if (currentRole === "dealer" && currentApprovalStatus === "pending") {
      addCarButton.textContent = "Save Draft Listing";
      setText(adminMessage, "Your seller application is pending review. You can prepare private draft listings, but buyers cannot see them yet.");
      setText(document.getElementById("listingPermissionNotice"), "Draft mode: listings you save now stay private until your account is approved.");
    }
  } catch (error) {
    console.error("Refresh seller approval status failed:", error);
    setText(formMessage, "Could not refresh your approval status: " + (error.code || error.message), true);
    return;
  }

  if (!currentCanPublish && !(currentRole === "dealer" && currentApprovalStatus === "pending")) {
      const diag = [
        "=== PERMISSION DIAGNOSTICS ===",
        "Current UID: " + currentUid,
        "Current Role: " + currentRole,
        "Current Approval Status: " + currentApprovalStatus,
        "Current Can Publish: " + currentCanPublish,
        "Profile active: " + (currentProfile?.active),
        "Profile role: " + (currentProfile?.role),
        "Profile approvalStatus: " + (currentProfile?.approvalStatus),
        "Profile accountStatus: " + (currentProfile?.accountStatus),
        "Expected for publish: role=dealer, active=true, approvalStatus=approved",
        "==============================="
      ].join("\n");
      console.error(diag);
      setText(formMessage, "Your account is not permitted to create listings at this time.\n" + diag, true);
      return;
    }
  if (!currentWhatsApp) {
    setText(formMessage, "Please save your WhatsApp number above before adding a vehicle.", true);
    whatsappForm.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!document.getElementById("authorizationConfirmed").checked) {
    setText(formMessage, "Confirm that you have permission to advertise this specific vehicle.", true);
    return;
  }

  const selectedPhotos = Array.from(carPhotosInput.files || []);
  const isEditing = editingCarId !== null;

  // In edit mode, photos are optional (can keep existing)
  if (!isEditing) {
    const photoError = validatePhotos(selectedPhotos);
    if (photoError) {
      setText(formMessage, photoError, true);
      return;
    }
  }

  addCarButton.disabled = true;
  carPhotosInput.disabled = true;
  setText(formMessage, isEditing ? "Saving changes..." : "Preparing vehicle photos...");

  // Determine if this is a draft (pending dealers save drafts, not live listings)
  const listingIsDraft = currentRole === "dealer" && currentApprovalStatus === "pending";

  try {
    const images = [];
    for (let i = 0; i < selectedPhotos.length; i += 1) {
      images.push(await uploadPhoto(selectedPhotos[i], i + 1, selectedPhotos.length));
    }
    
    const carData = {
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
      vehicleRelationship: document.getElementById("vehicleRelationship").value,
      authorizationConfirmed: document.getElementById("authorizationConfirmed").checked,
    };

    if (isEditing) {
      // EDIT MODE: Update existing vehicle
      console.log("=== EDIT MODE DEBUG ===");
      console.log("editingCarId:", editingCarId);
      console.log("editingCarSource:", editingCarSource);
      console.log("carData:", carData);
      console.log("existingImageUrls:", existingImageUrls);
      console.log("new images:", images);
      console.log("========================");
      
      await updateCar(editingCarId, editingCarSource, carData, images);
      
      // Reset edit mode
      cancelEdit();
      
      setText(formMessage, "Vehicle updated successfully!");
      await loadMyCars();
    } else {
      // CREATE MODE: Add new vehicle
      const car = {
        ...carData,
        images,
        imageUrl: images[0].url,
        addedBy: currentUid,
        sellerWhatsApp: currentWhatsApp,
        sellerName: currentAdminName,
        listingStatus: listingIsDraft ? "draft" : "pending_payment",
        paymentStatus: listingIsDraft ? "not_due" : "pending",
        listingFee: listingFeeForPrice(readNumber("price")),
        createdAt: serverTimestamp()
      };

      // DEBUG: Log the exact car object being sent to Firestore
      console.log("=== FIRESTORE WRITE DEBUG ===");
      console.log("Target collection:", listingIsDraft ? "dealerDrafts" : "cars");
      console.log("listingIsDraft:", listingIsDraft);
      console.log("currentRole:", currentRole);
      console.log("currentApprovalStatus:", currentApprovalStatus);
      console.log("Car object:", JSON.stringify(car, (key, value) => {
        if (key === 'createdAt' && value?.seconds) return `Timestamp(${value.seconds})`;
        return value;
      }, 2));
      console.log("Key field checks:");
      console.log("  price:", car.price, "type:", typeof car.price, ">0:", car.price > 0);
      console.log("  listingFee:", car.listingFee, "type:", typeof car.listingFee, ">=0:", car.listingFee >= 0);
      console.log("  listingStatus:", car.listingStatus);
      console.log("  paymentStatus:", car.paymentStatus);
      console.log("  authorizationConfirmed:", car.authorizationConfirmed);
      console.log("  vehicleRelationship:", car.vehicleRelationship, "valid:", ["owner", "broker", "authorized_representative"].includes(car.vehicleRelationship));
      console.log("  addedBy:", car.addedBy, "=== currentUid:", car.addedBy === currentUid);
      console.log("==============================");

      setText(uploadProgress, "Photos uploaded. Saving vehicle details...");
      const targetCollection = listingIsDraft ? "dealerDrafts" : "cars";
      await addDoc(collection(db, targetCollection), car);
      carForm.reset();
      photoPreview.replaceChildren();
      setText(uploadProgress, "");
      const fee = listingFeeForPrice(car.price);
      setText(formMessage, listingIsDraft
        ? "Draft saved privately. It will not appear to buyers until your seller account is approved."
        : "Listing submitted with " + images.length + (images.length === 1 ? " photo. " : " photos. ") +
          "Estimated listing fee: KSh " + fee.toLocaleString("en-KE") +
          ". It remains hidden until Kiri Cars verifies payment or approves your eligible free-trial listing.");
      await loadMyCars();
    }
  } catch (error) {
    console.error("Save vehicle failed:", error);
    // Enhanced error reporting for permission denied
    let errorDetail = error.code || error.message;
    if (error.code === "permission-denied" || error.message?.includes("permission")) {
      errorDetail += "\n\n=== FIRESTORE PERMISSION DENIED ===";
      errorDetail += "\nThis means the Firestore security rules rejected the write.";
      errorDetail += "\nTarget collection: " + (listingIsDraft ? "dealerDrafts" : "cars");
      errorDetail += "\nCurrent user: " + currentUid;
      errorDetail += "\nCurrent role: " + currentRole;
      errorDetail += "\nApproval status: " + currentApprovalStatus;
      errorDetail += "\nProfile active: " + currentProfile?.active;
      errorDetail += "\nProfile role: " + currentProfile?.role;
      errorDetail += "\nProfile approvalStatus: " + currentProfile?.approvalStatus;
      errorDetail += "\n\nCheck Firestore rules: isActiveSeller() requires:";
      errorDetail += "\n  1. admins/{uid} document exists";
      errorDetail += "\n  2. data.active == true";
      errorDetail += "\n  3. data.role == 'dealer' AND data.approvalStatus == 'approved'";
      errorDetail += "\n  (OR role == 'admin' OR role == 'owner')";
      errorDetail += "\n================================";
    }
    setText(formMessage, "Could not save vehicle: " + errorDetail, true);
    setText(uploadProgress, "If photos uploaded before the error, they may remain in Cloudinary and need cleanup.", true);
  } finally {
    addCarButton.disabled = !currentCanPublish && !(currentRole === "dealer" && currentApprovalStatus === "pending");
    carPhotosInput.disabled = !currentCanPublish && !(currentRole === "dealer" && currentApprovalStatus === "pending");
  }
});

// Cancel edit button handler
const cancelEditButton = document.getElementById("cancelEditButton");
if (cancelEditButton) {
  cancelEditButton.addEventListener("click", () => {
    cancelEdit();
  });
}

async function loadMyCars() {
  if (!currentUid) return;
  myCars.textContent = "Loading your listings...";

  try {
    let cars = [];
    // Only pending dealers can read dealerDrafts; approved dealers only read cars
    const isPendingDealer = currentRole === "dealer" && currentApprovalStatus === "pending";
    if (isPendingDealer) {
      const [publishedSnapshot, draftsSnapshot] = await Promise.all([
        getDocs(query(collection(db, "cars"), where("addedBy", "==", currentUid))),
        getDocs(query(collection(db, "dealerDrafts"), where("addedBy", "==", currentUid)))
      ]);
      cars = [
        ...publishedSnapshot.docs.map((d) => ({ id: d.id, _source: "cars", ...d.data() })),
        ...draftsSnapshot.docs.map((d) => ({ id: d.id, _source: "dealerDrafts", ...d.data() }))
      ];
    } else {
      const result = await getDocs(query(collection(db, "cars"), where("addedBy", "==", currentUid)));
      cars = result.docs.map((d) => ({ id: d.id, _source: "cars", ...d.data() }));
    }

    allMyCars = cars;
    updateListingOverview(allMyCars);
    renderFilteredCars();
  } catch (error) {
    console.error("Load vehicles failed:", error);
    myCars.textContent = "Could not load vehicles: " + (error.code || error.message);
    if (listingFilterSummary) listingFilterSummary.textContent = "Listings could not be loaded.";
    Object.values(overviewCountElements).forEach((element) => {
      if (element) element.textContent = "—";
    });
  }
}

function renderFilteredCars() {
  const search = listingSearchInput.value.trim().toLocaleLowerCase();
  const status = listingStatusFilter.value;
  const now = Date.now();
  const cars = allMyCars.filter((car) => {
    const searchableText = [car.year, car.manufacturer, car.model]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();

    if (search && !searchableText.includes(search)) return false;
    if (status === "expiring") return isExpiringSoon(car, now);
    return !status || listingCategory(car, now) === status;
  });

  const sortBy = listingSortSelect.value;
  cars.sort((a, b) => {
    if (sortBy === "price-low" || sortBy === "price-high") {
      const priceA = Number(a.price) || 0;
      const priceB = Number(b.price) || 0;
      return sortBy === "price-low" ? priceA - priceB : priceB - priceA;
    }

    if (sortBy === "expiry") {
      const expiryA = timestampMillis(a.listingExpiresAt) ?? Number.POSITIVE_INFINITY;
      const expiryB = timestampMillis(b.listingExpiresAt) ?? Number.POSITIVE_INFINITY;
      if (expiryA !== expiryB) return expiryA - expiryB;
    }

    return (timestampMillis(b.createdAt) || 0) - (timestampMillis(a.createdAt) || 0);
  });

  myCars.replaceChildren();
  if (listingFilterSummary) {
    listingFilterSummary.textContent = `Showing ${cars.length.toLocaleString("en-KE")} of ${allMyCars.length.toLocaleString("en-KE")} listings`;
  }

  if (allMyCars.length === 0) {
    myCars.textContent = "You have not added any vehicles yet.";
    return;
  }

  if (cars.length === 0) {
    myCars.textContent = "No listings match these filters. Try a different search or status.";
    return;
  }

  cars.forEach((car) => myCars.appendChild(renderCar(car)));
}

function renderCar(car) {
  const card = document.createElement("div");
  card.className = "dashboard-card";

  const title = document.createElement("h4");
  title.textContent = [car.year, car.manufacturer, car.model].filter(Boolean).join(" ");

  const details = document.createElement("p");
  const price = typeof car.price === "number" ? "KSh " + car.price.toLocaleString() : "Price not set";
  details.textContent = [car.carType, displayVehicleStatus(car.status), car.fuel, car.transmission, price].filter(Boolean).join(" · ");

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

  const lifecycle = document.createElement("p");
  lifecycle.className = "listing-lifecycle";
  if (car._source === "dealerDrafts" || car.listingStatus === "draft") {
    lifecycle.textContent = "PRIVATE DRAFT — not visible to buyers";
    lifecycle.classList.add("draft-label");
  } else if (car.listingStatus === "pending_payment" || car.paymentStatus === "pending") {
    lifecycle.textContent = "PAYMENT PENDING — hidden from buyers";
    lifecycle.classList.add("expired-label");
  } else if (car.listingStatus === "suspended") {
    lifecycle.textContent = "SUSPENDED — not visible to buyers";
    lifecycle.classList.add("expired-label");
  } else if (car.listingStatus === "sold") {
    lifecycle.textContent = "SOLD — marked for removal after 72 hours";
    lifecycle.classList.add("sold-label");
  } else if (car.listingExpiresAt?.toMillis && car.listingExpiresAt.toMillis() <= Date.now()) {
    lifecycle.textContent = "EXPIRED — hidden from public listings until renewed";
    lifecycle.classList.add("expired-label");
  } else {
    lifecycle.textContent = "Listing status: Active";
  }

  card.append(title, details, lifecycle);

  if (car._source === "dealerDrafts") {
    if (currentCanPublish) {
      const publishButton = document.createElement("button");
      publishButton.type = "button";
      publishButton.textContent = "Publish Draft";
      publishButton.className = "publish-button";
      publishButton.addEventListener("click", () => publishDraft(car, publishButton));
      card.appendChild(publishButton);
    }
    if (currentCanPublish || (currentRole === "dealer" && currentApprovalStatus === "pending")) {
      const deleteDraftButton = document.createElement("button");
      deleteDraftButton.type = "button";
      deleteDraftButton.textContent = "Delete Draft";
      deleteDraftButton.className = "delete-button";
      deleteDraftButton.addEventListener("click", () => deleteCar(car, deleteDraftButton));
      card.appendChild(deleteDraftButton);
    }
    return card;
  }

  if (car.listingStatus !== "sold" && car.listingStatus !== "suspended" && currentCanPublish) {
    const soldButton = document.createElement("button");
    soldButton.type = "button";
    soldButton.textContent = "Mark as Sold";
    soldButton.className = "sold-button";
    soldButton.addEventListener("click", () => markCarSold(car, soldButton));
    card.appendChild(soldButton);
  }

  // Edit button - allow editing for all active listings and drafts
  if ((car._source === "cars" && car.listingStatus !== "sold" && car.listingStatus !== "suspended") || car._source === "dealerDrafts") {
    if (currentCanPublish || (currentRole === "dealer" && currentApprovalStatus === "pending")) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.className = "edit-button";
      editButton.addEventListener("click", () => editCar(car));
      card.appendChild(editButton);
    }
  }

  if (currentCanPublish) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Delete";
    removeButton.className = "delete-button";
    removeButton.addEventListener("click", () => deleteCar(car, removeButton));
    card.appendChild(removeButton);
  }
  return card;
}

async function publishDraft(car, button) {
  if (!currentCanPublish || car._source !== "dealerDrafts" || car.addedBy !== currentUid) return;
  if (!car.authorizationConfirmed || !car.vehicleRelationship) {
    alert("This draft is missing the vehicle permission declaration. Delete it and prepare a complete listing.");
    return;
  }
  if (!confirm("Publish " + car.manufacturer + " " + car.model + " so buyers can see it?")) return;

  button.disabled = true;
  try {
    const published = { ...car };
    delete published.id;
    delete published._source;
    published.listingStatus = "pending_payment";
    published.paymentStatus = "pending";
    published.listingFee = listingFeeForPrice(published.price);
    delete published.listingExpiresAt;
    published.publishedAt = serverTimestamp();
    await addDoc(collection(db, "cars"), published);
    await deleteDoc(doc(db, "dealerDrafts", car.id));
    await loadMyCars();
  } catch (error) {
    console.error("Publish draft failed:", error);
    alert("Could not publish this draft: " + (error.code || error.message));
    button.disabled = false;
  }
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
    const collectionName = car._source === "dealerDrafts" ? "dealerDrafts" : "cars";
    await deleteDoc(doc(db, collectionName, car.id));
    await loadMyCars();
  } catch (error) {
    console.error("Delete failed:", error);
    alert("Could not delete: " + (error.code || error.message));
    button.disabled = false;
  }
}

async function editCar(car) {
  if (car.addedBy !== currentUid) {
    alert("You can only edit vehicles you added.");
    return;
  }

  // DEBUG: Log the car data and user profile
  console.log("=== EDIT CAR DEBUG ===");
  console.log("Car ID:", car.id);
  console.log("Car source:", car._source);
  console.log("Car listingStatus:", car.listingStatus);
  console.log("Car addedBy:", car.addedBy);
  console.log("Current UID:", currentUid);
  console.log("Current Role:", currentRole);
  console.log("Current Approval Status:", currentApprovalStatus);
  console.log("Current Profile:", currentProfile);
  
  // Detailed profile check for Firestore rules
  console.log("--- PROFILE FIELD CHECK FOR FIRESTORE RULES ---");
  console.log("profile.active:", currentProfile?.active);
  console.log("profile.role:", currentProfile?.role);
  console.log("profile.approvalStatus:", currentProfile?.approvalStatus);
  console.log("profile.verificationStatus:", currentProfile?.verificationStatus);
  console.log("profile.accountStatus:", currentProfile?.accountStatus);
  console.log("profile.name:", currentProfile?.name);
  console.log("Is active === true:", currentProfile?.active === true);
  console.log("Role normalized:", String(currentProfile?.role || "").trim().toLowerCase());
  console.log("Approval status normalized:", String(currentProfile?.approvalStatus || "").trim().toLowerCase());
  console.log("----------------------------------------------");
  console.log("======================");

  // Set edit mode state
  editingCarId = car.id;
  editingCarSource = car._source;
  originalCarData = { ...car };

  // Switch to Add Vehicle section to show the edit form
  showSection("add-vehicle");

  // Scroll to form
  carForm.scrollIntoView({ behavior: "smooth", block: "center" });

  // Populate form fields
  document.getElementById("manufacturer").value = car.manufacturer || "";
  document.getElementById("carType").value = car.carType || "";
  document.getElementById("model").value = car.model || "";
  document.getElementById("year").value = car.year || "";
  document.getElementById("price").value = car.price || "";
  document.getElementById("status").value = displayVehicleStatus(car.status);
  document.getElementById("mileage").value = car.mileage || "";
  document.getElementById("fuel").value = car.fuel || "";
  document.getElementById("transmission").value = car.transmission || "";
  document.getElementById("description").value = car.description || "";
  document.getElementById("vehicleRelationship").value = car.vehicleRelationship || "";
  document.getElementById("authorizationConfirmed").checked = car.authorizationConfirmed === true;

  // Store existing images
  existingImageUrls = Array.isArray(car.images) 
    ? car.images.map((item) => item?.url).filter(Boolean) 
    : (car.imageUrl ? [car.imageUrl] : []);

  // Show existing images in preview
  photoPreview.replaceChildren();
  existingImageUrls.forEach((url, index) => {
    const figure = document.createElement("figure");
    figure.className = "photo-preview-item";
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Existing photo ${index + 1}`;
    image.loading = "lazy";
    const caption = document.createElement("figcaption");
    caption.textContent = `Existing photo ${index + 1}`;
    figure.append(image, caption);
    photoPreview.appendChild(figure);
  });

  // Update form UI for edit mode
  addCarButton.textContent = "Save Changes";
  setText(uploadProgress, "Editing vehicle. Select new photos to replace existing ones, or leave empty to keep current photos.");
  formMessage.textContent = "";

  // Show cancel button
  if (cancelEditButton) cancelEditButton.style.display = "inline-block";

  // Make photos optional in edit mode (they can keep existing ones)
  carPhotosInput.required = false;
}

function cancelEdit() {
  // Reset edit mode state
  editingCarId = null;
  editingCarSource = null;
  originalCarData = null;
  existingImageUrls = [];

  // Reset form
  carForm.reset();
  photoPreview.replaceChildren();
  setText(uploadProgress, "");
  formMessage.textContent = "";
  addCarButton.textContent = "Add Vehicle";
  carPhotosInput.required = true;

  // Hide cancel button
  if (cancelEditButton) cancelEditButton.style.display = "none";
}

async function updateCar(carId, source, carData, newImages) {
  const collectionName = source === "dealerDrafts" ? "dealerDrafts" : "cars";
  const carRef = doc(db, collectionName, carId);
  
  // Combine existing images with new ones (new images first)
  const allImages = [...newImages, ...existingImageUrls.map(url => ({ url, publicId: "" }))];
  
  const updateData = {
    ...carData,
    images: allImages,
    imageUrl: allImages[0]?.url || "",
    updatedAt: serverTimestamp()
  };
  
  // Remove fields that shouldn't be updated
  delete updateData.id;
  delete updateData._source;
  delete updateData.addedBy;
  delete updateData.sellerWhatsApp;
  delete updateData.sellerName;
  delete updateData.createdAt;
  
  console.log("=== UPDATECAR DEBUG ===");
  console.log("collectionName:", collectionName);
  console.log("carId:", carId);
  console.log("updateData keys:", Object.keys(updateData));
  console.log("updateData:", updateData);
  // Detailed field validation
  console.log("--- FIELD VALUES FOR RULES CHECK ---");
  console.log("manufacturer:", updateData.manufacturer, typeof updateData.manufacturer);
  console.log("carType:", updateData.carType, typeof updateData.carType);
  console.log("model:", updateData.model, typeof updateData.model);
  console.log("year:", updateData.year, typeof updateData.year);
  console.log("price:", updateData.price, typeof updateData.price);
  console.log("status:", updateData.status, typeof updateData.status);
  console.log("mileage:", updateData.mileage, typeof updateData.mileage);
  console.log("fuel:", updateData.fuel, typeof updateData.fuel);
  console.log("transmission:", updateData.transmission, typeof updateData.transmission);
  console.log("description:", updateData.description, typeof updateData.description);
  console.log("vehicleRelationship:", updateData.vehicleRelationship, typeof updateData.vehicleRelationship);
  console.log("authorizationConfirmed:", updateData.authorizationConfirmed, typeof updateData.authorizationConfirmed);
  console.log("images:", updateData.images, Array.isArray(updateData.images));
  console.log("imageUrl:", updateData.imageUrl, typeof updateData.imageUrl);
  console.log("updatedAt:", updateData.updatedAt, typeof updateData.updatedAt);
  console.log("-------------------------------------");
  console.log("========================");
  
  await updateDoc(carRef, updateData);
}


async function loadSellerDirectory() {
  const list = document.getElementById("sellerDirectoryList");
  const message = document.getElementById("sellerDirectoryMessage");
  if (!list || !message) return;
  list.textContent = "Loading seller directory...";
  message.textContent = "";
  try {
    const snapshot = await getDocs(collection(db, "admins"));
    const accounts = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((account) => ["owner", "admin", "dealer"].includes(normalizeRole(account.role)))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    list.replaceChildren();
    if (!accounts.length) {
      list.textContent = "No team accounts found.";
      return;
    }
    accounts.forEach((account) => {
      const row = document.createElement("article");
      row.className = "admin-list-item";
      const name = document.createElement("strong");
      name.textContent = account.name || "Unnamed account";
      const email = document.createElement("p");
      email.textContent = account.email || "No email recorded";
      const role = normalizeRole(account.role);
      let category = "Administrator";
      if (role === "dealer") {
        category = account.sellerType === "broker"
          ? "Independent Sales Representative"
          : account.sellerType === "dealership"
            ? "Showroom Representative"
            : "Seller category not recorded";
      } else if (role === "owner") {
        category = "Kiri Cars Owner";
      }
      const type = document.createElement("p");
      type.textContent = "Category: " + category +
        (account.businessName ? " · " + account.businessName : "");
      const status = document.createElement("p");
      status.textContent = "Account: " +
        (account.active === true ? "Active" : "Inactive / pending") +
        (account.approvalStatus ? " · Approval: " + account.approvalStatus : "");
      row.append(name, email, type, status);
      list.appendChild(row);
    });
    message.textContent = "Loaded " + accounts.length + " team account(s).";
  } catch (error) {
    console.error("Seller directory load failed:", error);
    list.textContent = "Could not load the seller directory.";
    message.textContent = "Access denied or account records could not be loaded. The latest Firestore rules must be published by the owner.";
  }
}

document.getElementById("loadSellerDirectoryButton")?.addEventListener("click", loadSellerDirectory);

// Diagnostic: Check current user's profile status
async function checkProfileStatus() {
  const btn = document.getElementById("checkProfileButton");
  const msg = document.getElementById("profileDiagnosticsMessage");
  const output = document.getElementById("profileDiagnosticsOutput");
  
  if (!btn || !msg || !output) return;
  
  btn.disabled = true;
  btn.textContent = "Checking...";
  msg.textContent = "Fetching your profile from Firestore...";
  output.style.display = "none";
  
  try {
    if (!currentUid) {
      throw new Error("Not signed in");
    }
    
    const snap = await getDoc(doc(db, "admins", currentUid));
    if (!snap.exists()) {
      throw new Error("No profile document found at admins/" + currentUid);
    }
    
    const profile = snap.data();
    const role = normalizeRole(profile.role);
    const approvalStatus = String(profile.approvalStatus || (role === "admin" ? "approved" : "pending")).toLowerCase();
    const active = profile.active === true;
    const accountStatus = profile.accountStatus || "not_set";
    const canPublish = (role === "admin" && active) || (role === "dealer" && active && approvalStatus === "approved");
    
    const lines = [
      "=== FIRESTORE PROFILE DIAGNOSTICS ===",
      "Document path: admins/" + currentUid,
      "Document exists: YES",
      "",
      "--- Raw Profile Data ---",
      JSON.stringify(profile, null, 2),
      "",
      "--- Key Fields for Publishing ---",
      "role: " + (profile.role || "MISSING"),
      "active: " + active + " (raw: " + profile.active + ")",
      "approvalStatus: " + approvalStatus + " (raw: " + profile.approvalStatus + ")",
      "accountStatus: " + accountStatus,
      "sellerType: " + (profile.sellerType || "N/A"),
      "businessName: " + (profile.businessName || "N/A"),
      "whatsapp: " + (profile.whatsapp || "NOT SET"),
      "",
      "--- Permission Analysis ---",
      "isActiveSeller check:",
      "  1. hasSellerProfile: YES (document exists)",
      "  2. data.active == true: " + (active ? "PASS" : "FAIL - must be true"),
      "  3. role check:",
      "     - role == 'admin': " + (role === "admin" ? "PASS" : "no"),
      "     - role == 'owner': " + (role === "owner" ? "PASS" : "no"),
      "     - role == 'dealer' AND approvalStatus == 'approved': " + 
        (role === "dealer" && approvalStatus === "approved" ? "PASS" : "FAIL"),
      "",
      "OVERALL isActiveSeller: " + (active && (role === "admin" || role === "owner" || (role === "dealer" && approvalStatus === "approved")) ? "PASS" : "FAIL"),
      "Can Publish (currentCanPublish): " + (canPublish ? "YES" : "NO"),
      "",
      "--- Required to Publish Vehicles ---",
      "✓ Role must be 'dealer', 'admin', or 'owner'",
      "✓ active must be exactly true (boolean)",
      "✓ If dealer: approvalStatus must be 'approved'",
      "✓ WhatsApp number must be saved",
      "✓ Authorization checkbox must be checked",
      "",
      "=== END DIAGNOSTICS ==="
    ];
    
    output.textContent = lines.join("\n");
    output.style.display = "block";
    
    if (canPublish) {
      msg.textContent = "✓ Your profile allows publishing vehicles!";
      msg.style.color = "#167a35";
    } else {
      msg.textContent = "✗ Your profile does NOT allow publishing. See details above.";
      msg.style.color = "#c62828";
    }
    
  } catch (error) {
    console.error("Profile check failed:", error);
    msg.textContent = "Error: " + (error.code || error.message);
    msg.style.color = "#c62828";
    output.textContent = "Error: " + error.stack;
    output.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "Check My Profile Status";
  }
}

document.getElementById("checkProfileButton")?.addEventListener("click", checkProfileStatus);

 
document.getElementById("checkProfileButton")?.addEventListener("click", checkProfileStatus);

const deleteAccountButton = document.getElementById("deleteAccountButton");
const deleteAccountMessage = document.getElementById("deleteAccountMessage");

deleteAccountButton?.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "⚠️ DANGER ZONE ⚠️\n\n" +
    "This will PERMANENTLY DELETE:\n" +
    "• Your Kiri Cars account\n" +
    "• ALL your vehicle listings\n" +
    "• Your Firebase Auth account\n\n" +
    "This action CANNOT BE UNDONE.\n\n" +
    "Type 'DELETE' to confirm:"
  );

  if (!confirmed) return;

  const userInput = window.prompt("Type 'DELETE' to confirm permanent account deletion:");
  if (userInput !== "DELETE") {
    deleteAccountMessage.textContent = "Deletion cancelled - confirmation text did not match.";
    deleteAccountMessage.style.color = "#dc2626";
    return;
  }

  deleteAccountButton.disabled = true;
  deleteAccountButton.textContent = "Deleting account...";
  deleteAccountMessage.textContent = "Deleting your account and all listings...";
  deleteAccountMessage.style.color = "#6b7280";

  try {
    const user = auth.currentUser;
    const uid = user?.uid;

    if (!uid) {
      throw new Error("No authenticated user found");
    }

    // Delete all vehicles created by this user
    const carsQuery = query(collection(db, "cars"), where("addedBy", "==", uid));
    const carsSnapshot = await getDocs(carsQuery);

    const deletePromises = carsSnapshot.docs.map((docSnap) => deleteDoc(docSnap.ref));
    await Promise.all(deletePromises);

    // Delete the admin profile document
    await deleteDoc(doc(db, "admins", uid));

    // Delete the Firebase Auth user
    await deleteUser(user);

    deleteAccountMessage.textContent = "Account deleted successfully. Redirecting...";
    deleteAccountMessage.style.color = "#059669";

    // Redirect to home page after a short delay
    setTimeout(() => {
      window.location.href = "index.html";
    }, 2000);

  } catch (error) {
    console.error("Account deletion failed:", error);
    deleteAccountButton.disabled = false;
    deleteAccountButton.textContent = "Delete My Account Permanently";

    if (error.code === "auth/requires-recent-login") {
      deleteAccountMessage.textContent = "Please sign in again and try deleting your account (security requirement).";
    } else {
      deleteAccountMessage.textContent = "Failed to delete account: " + error.message;
    }
    deleteAccountMessage.style.color = "#dc2626";
  }
});

// ===== Sidebar Navigation =====
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const navItems = document.querySelectorAll(".nav-item");
const contentSections = document.querySelectorAll(".content-section");

function setMobileSidebarOpen(isOpen) {
  sidebar.classList.toggle("open", isOpen);
  sidebar.classList.toggle("expanded", isOpen);
  sidebar.inert = !isOpen;
  sidebar.setAttribute("aria-hidden", String(!isOpen));
  sidebarToggle.setAttribute("aria-expanded", String(isOpen));
  sidebarToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
  sidebarOverlay.classList.toggle("visible", isOpen);
  sidebarOverlay.setAttribute("aria-hidden", String(!isOpen));
  sidebarOverlay.tabIndex = isOpen ? 0 : -1;
}

function showSection(sectionId) {
  // Update nav items
  navItems.forEach(item => {
    item.classList.toggle("active", item.dataset.section === sectionId);
  });

  // Update content sections
  contentSections.forEach(section => {
    section.classList.toggle("active", section.id === `section-${sectionId}`);
  });

  // Auto-load cars when My Listings section is shown
  if (sectionId === "my-listings") {
    loadMyCars();
  }

  // On mobile, collapse sidebar after selection
  if (window.innerWidth <= 768) {
    setMobileSidebarOpen(false);
  }
}

navItems.forEach(item => {
  item.addEventListener("click", () => {
    showSection(item.dataset.section);
  });
});

listingSearchInput.addEventListener("input", renderFilteredCars);
listingStatusFilter.addEventListener("change", renderFilteredCars);
listingSortSelect.addEventListener("change", renderFilteredCars);

document.getElementById("clearListingFiltersButton").addEventListener("click", () => {
  listingSearchInput.value = "";
  listingStatusFilter.value = "";
  listingSortSelect.value = "newest";
  renderFilteredCars();
});

document.querySelectorAll("[data-listing-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    listingSearchInput.value = "";
    listingStatusFilter.value = button.dataset.listingFilter;
    listingSortSelect.value = "newest";
    showSection("my-listings");
  });
});

document.querySelectorAll("[data-open-section]").forEach((button) => {
  button.addEventListener("click", () => {
    showSection(button.dataset.openSection);
  });
});

// Hamburger menu toggles sidebar expanded/collapsed
sidebarToggle?.addEventListener("click", () => {
  if (window.innerWidth <= 768) {
    setMobileSidebarOpen(!sidebar.classList.contains("open"));
    return;
  }

  sidebar.classList.toggle("expanded");
  sidebarToggle.setAttribute("aria-expanded", String(sidebar.classList.contains("expanded")));
});

sidebarOverlay?.addEventListener("click", () => setMobileSidebarOpen(false));

// Handle window resize
window.addEventListener("resize", () => {
  // On mobile, collapse sidebar (use .open for mobile slide-in)
  // On desktop, keep sidebar expanded by default
  if (window.innerWidth <= 768) {
    setMobileSidebarOpen(false);
  } else {
    sidebar.classList.remove("open");
    sidebar.classList.add("expanded");
    sidebar.inert = false;
    sidebar.removeAttribute("aria-hidden");
    sidebarToggle.setAttribute("aria-expanded", "true");
    sidebarToggle.setAttribute("aria-label", "Collapse navigation menu");
    sidebarOverlay.classList.remove("visible");
    sidebarOverlay.setAttribute("aria-hidden", "true");
    sidebarOverlay.tabIndex = -1;
  }
});

if (window.innerWidth <= 768) {
  setMobileSidebarOpen(false);
} else {
  sidebarToggle.setAttribute("aria-expanded", "true");
  sidebarToggle.setAttribute("aria-label", "Collapse navigation menu");
}

// Theme toggle functionality
function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);
}

function updateThemeIcon(theme) {
  if (themeToggle) {
    themeToggle.textContent = theme === "dark" ? "🌙" : "☀️";
    themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
}

themeToggle?.addEventListener("click", () => {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
  updateThemeIcon(newTheme);
});

// Initialize theme on page load
initTheme();

// Profile avatar functions
function loadProfileAvatar(profile, user) {
  if (!profileAvatarBtn || !profileAvatarImg) return;
  
  const avatarUrl = profile.avatarUrl || profile.photoURL;
  if (avatarUrl) {
    profileAvatarImg.src = avatarUrl;
    profileAvatarImg.style.display = "block";
    profileAvatarBtn.querySelector(".avatar-placeholder").style.display = "none";
    
    // Also update dropdown avatar
    if (profileDropdownAvatarImg) {
      profileDropdownAvatarImg.src = avatarUrl;
      profileDropdownAvatarImg.style.display = "block";
      profileDropdownAvatarImg.previousElementSibling.style.display = "none";
    }
  } else {
    profileAvatarImg.style.display = "none";
    profileAvatarBtn.querySelector(".avatar-placeholder").style.display = "block";
    
    // Also update dropdown avatar
    if (profileDropdownAvatarImg) {
      profileDropdownAvatarImg.style.display = "none";
      profileDropdownAvatarImg.previousElementSibling.style.display = "block";
    }
  }
  
  // Update dropdown user info
  if (profileDropdownName && profile) {
    profileDropdownName.textContent = profile.name || "User";
  }
  if (profileDropdownEmail && user) {
    profileDropdownEmail.textContent = user.email || "";
  }
  if (profileDropdownRole && profile) {
    const role = profile.role || currentRole;
    profileDropdownRole.textContent = role ? role.charAt(0).toUpperCase() + role.slice(1) : "";
  }
}

async function uploadProfileAvatar(file) {
  if (!currentUid) return null;
  
  try {
    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file.");
      return null;
    }
    
    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert("Image must be less than 2MB.");
      return null;
    }
    
    // Create a reference to the storage location
    const avatarRef = ref(storage, `profile-avatars/${currentUid}.${file.type.split("/")[1]}`);
    
    // Upload the file
    const snapshot = await uploadBytes(avatarRef, file);
    
    // Get the download URL
    const downloadURL = await getDownloadURL(snapshot.ref);
    
    // Update the user's profile in Firestore
    const userDocRef = doc(db, "users", currentUid);
    await updateDoc(userDocRef, {
      avatarUrl: downloadURL,
      updatedAt: serverTimestamp()
    });
    
    return downloadURL;
  } catch (error) {
    console.error("Error uploading avatar:", error);
    alert("Failed to upload profile picture. Please try again.");
    return null;
  }
}

// Profile dropdown toggle
profileAvatarBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = !profileDropdownMenu.hidden;
  profileDropdownMenu.hidden = isOpen;
  profileAvatarBtn.setAttribute("aria-expanded", !isOpen);
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  if (profileDropdown && !profileDropdown.contains(e.target)) {
    profileDropdownMenu.hidden = true;
    profileAvatarBtn.setAttribute("aria-expanded", "false");
  }
});

// Close dropdown on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !profileDropdownMenu.hidden) {
    profileDropdownMenu.hidden = true;
    profileAvatarBtn.setAttribute("aria-expanded", "false");
    profileAvatarBtn.focus();
  }
});

// Logout from dropdown
logoutDropdownBtn?.addEventListener("click", async () => {
  await signOut(auth);
  goToLogin();
});

// Edit profile button - opens modal for editing name and avatar
editProfileBtn?.addEventListener("click", () => {
  profileDropdownMenu.hidden = true;
  profileAvatarBtn.setAttribute("aria-expanded", "false");
  openEditProfileModal();
});

// Change password button
changePasswordBtn?.addEventListener("click", () => {
  profileDropdownMenu.hidden = true;
  profileAvatarBtn.setAttribute("aria-expanded", "false");
  // Firebase Auth handles password reset via email
  const email = auth.currentUser?.email;
  if (email) {
    // This would typically send a password reset email
    alert("Password reset functionality would be implemented here. For now, use the 'Forgot password' link on the login page.");
  }
});

// Edit Profile Modal Functions
function openEditProfileModal() {
  if (!currentProfile || !auth.currentUser) return;
  
  // Populate form with current data
  editProfileName.value = currentProfile.name || "";
  editProfileEmail.value = auth.currentUser.email || "";
  editProfileRole.value = currentRole ? currentRole.charAt(0).toUpperCase() + currentRole.slice(1) : "";
  
  // Populate avatar preview
  const avatarUrl = currentProfile.avatarUrl;
  if (avatarUrl) {
    editProfileAvatarImg.src = avatarUrl;
    editProfileAvatarImg.style.display = "block";
    editProfileAvatarPreview.querySelector(".avatar-placeholder").style.display = "none";
  } else {
    editProfileAvatarImg.style.display = "none";
    editProfileAvatarPreview.querySelector(".avatar-placeholder").style.display = "block";
  }
  
  // Show modal
  editProfileModal.hidden = false;
  editProfileName.focus();
  
  // Trap focus in modal
  document.body.style.overflow = "hidden";
}

function closeEditProfileModalFunc() {
  editProfileModal.hidden = true;
  document.body.style.overflow = "";
}

// Close modal handlers
closeEditProfileModal?.addEventListener("click", closeEditProfileModalFunc);
cancelEditProfileBtn?.addEventListener("click", closeEditProfileModalFunc);

// Close modal on backdrop click
editProfileModal?.addEventListener("click", (e) => {
  if (e.target === editProfileModal) {
    closeEditProfileModalFunc();
  }
});

// Close modal on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !editProfileModal.hidden) {
    closeEditProfileModalFunc();
  }
});

// Avatar input in modal
editProfileAvatarInput?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  // Validate file type
  if (!file.type.startsWith("image/")) {
    alert("Please select an image file.");
    return;
  }
  
  // Validate file size (max 2MB)
  if (file.size > 2 * 1024 * 1024) {
    alert("Image must be less than 2MB.");
    return;
  }
  
  // Show loading state
  const placeholder = editProfileAvatarPreview.querySelector(".avatar-placeholder");
  const originalText = placeholder.textContent;
  placeholder.textContent = "⏳";
  
  const downloadURL = await uploadProfileAvatar(file);
  
  if (downloadURL) {
    // Update the preview in modal
    editProfileAvatarImg.src = downloadURL;
    editProfileAvatarImg.style.display = "block";
    placeholder.style.display = "none";
    
    // Also update header and dropdown avatars
    profileAvatarImg.src = downloadURL;
    profileAvatarImg.style.display = "block";
    profileAvatarBtn.querySelector(".avatar-placeholder").style.display = "none";
    
    if (profileDropdownAvatarImg) {
      profileDropdownAvatarImg.src = downloadURL;
      profileDropdownAvatarImg.style.display = "block";
      profileDropdownAvatarImg.previousElementSibling.style.display = "none";
    }
    
    // Update currentProfile
    if (currentProfile) {
      currentProfile.avatarUrl = downloadURL;
    }
  } else {
    // Restore placeholder on failure
    placeholder.textContent = originalText;
    placeholder.style.display = "block";
    editProfileAvatarImg.style.display = "none";
  }
  
  // Reset the input
  e.target.value = "";
});

// Edit profile form submission
editProfileForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  if (!currentUid || !currentProfile) return;
  
  const newName = editProfileName.value.trim();
  if (!newName) {
    alert("Please enter your name.");
    return;
  }
  
  try {
    const submitBtn = editProfileForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
    
    // Update name in Firestore (admins collection for admin users)
    const userDocRef = doc(db, "admins", currentUid);
    await updateDoc(userDocRef, {
      name: newName,
      updatedAt: serverTimestamp()
    });
    
    // Update local profile
    currentProfile.name = newName;
    
    // Update UI in header and dropdown
    if (profileDropdownName) {
      profileDropdownName.textContent = newName;
    }
    
    alert("Profile updated successfully!");
    closeEditProfileModalFunc();
  } catch (error) {
    console.error("Error updating profile:", error);
    alert("Failed to update profile. Please try again.");
  } finally {
    const submitBtn = editProfileForm.querySelector('button[type="submit"]');
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Changes";
  }
});

// Debug: Verify DOM elements are found
console.log("Admin script loaded", {
  themeToggle: !!themeToggle,
  sidebarToggle: !!sidebarToggle,
  profileAvatarBtn: !!profileAvatarBtn,
  profileDropdown: !!profileDropdown,
  editProfileModal: !!editProfileModal,
});
 
