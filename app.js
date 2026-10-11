
import { auth, db } from "./firebase-config.js";

import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const carsGrid = document.getElementById("carsGrid");
const resultsCount = document.getElementById("resultsCount");
const filterForm = document.getElementById("filterForm");

const searchInput = document.getElementById("searchInput");
const manufacturerFilter = document.getElementById("manufacturerFilter");
const typeFilter = document.getElementById("typeFilter");
const yearFilter = document.getElementById("yearFilter");
const statusFilter = document.getElementById("statusFilter");
const minPriceInput = document.getElementById("minPrice");
const maxPriceInput = document.getElementById("maxPrice");

document.getElementById("currentYear").textContent =
  new Date().getFullYear();

let allCars = [];

function safeImageUrl(value) {
  if (!value) return "";

  try {
    const parsed = new URL(value);

    if (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:"
    ) {
      return parsed.href;
    }

    return "";
  } catch {
    return "";
  }
}

function timestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}

function publicListingIsVisible(car) {
  const now = Date.now();
  const expiry = timestampMillis(car.listingExpiresAt);
  if (expiry !== null && expiry <= now) return false;

  if (car.listingStatus === "sold") {
    const soldAt = timestampMillis(car.soldAt);
    if (soldAt !== null && now - soldAt >= 72 * 60 * 60 * 1000) return false;
  }

  return true;
}

function formatPrice(price) {
  const amount = Number(price);

  if (!Number.isFinite(amount) || amount <= 0) {
    return "Price on request";
  }

  return "KSh " + amount.toLocaleString("en-KE");
}

function addFilterOptions(select, values, placeholder) {
  const previousValue = select.value;

  select.replaceChildren();

  const firstOption = document.createElement("option");
  firstOption.value = "";
  firstOption.textContent = placeholder;
  select.appendChild(firstOption);

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    select.appendChild(option);
  });

  if (values.map(String).includes(previousValue)) {
    select.value = previousValue;
  }
}

function prepareFilters() {
  const manufacturers = [
    ...new Set(
      allCars
        .map((car) => String(car.manufacturer || "").trim())
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));

  const carTypes = [
    ...new Set(
      allCars
        .map((car) => String(car.carType || "").trim())
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));

  const years = [
    ...new Set(
      allCars
        .map((car) => Number(car.year))
        .filter((year) => Number.isInteger(year) && year > 0)
    )
  ].sort((a, b) => b - a);

  addFilterOptions(
    manufacturerFilter,
    manufacturers,
    "All manufacturers"
  );

  addFilterOptions(typeFilter, carTypes, "All types");
  addFilterOptions(yearFilter, years, "All years");
}

function createVehicleCard(car) {
  const card = document.createElement("article");
  card.className = "vehicle-card";

  const photoUrls = Array.isArray(car.images)
    ? car.images.map((item) => safeImageUrl(item?.url)).filter(Boolean)
    : [];
  if (!photoUrls.length) {
    const legacyUrl = safeImageUrl(car.imageUrl);
    if (legacyUrl) photoUrls.push(legacyUrl);
  }

  if (photoUrls.length) {
    const gallery = document.createElement("div");
    gallery.className = "vehicle-gallery";
    const image = document.createElement("img");
    image.src = photoUrls[0];
    image.alt = (car.manufacturer || "") + " " + (car.model || "vehicle");
    image.loading = "lazy";
    image.onerror = () => image.remove();
    gallery.appendChild(image);

    if (photoUrls.length > 1) {
      const thumbnails = document.createElement("div");
      thumbnails.className = "vehicle-thumbnails";
      photoUrls.forEach((url, index) => {
        const thumbnail = document.createElement("button");
        thumbnail.type = "button";
        thumbnail.className = "vehicle-thumbnail";
        thumbnail.setAttribute("aria-label", "Show vehicle photo " + (index + 1));
        const thumbImage = document.createElement("img");
        thumbImage.src = url;
        thumbImage.alt = "Photo " + (index + 1);
        thumbImage.loading = "lazy";
        thumbnail.appendChild(thumbImage);
        thumbnail.addEventListener("click", () => {
          image.src = url;
          image.alt = (car.manufacturer || "") + " " + (car.model || "vehicle") + " photo " + (index + 1);
        });
        thumbnails.appendChild(thumbnail);
      });
      gallery.appendChild(thumbnails);
    }
    card.appendChild(gallery);
  }

  const status = document.createElement("span");
  status.className = "status-tag";
  status.textContent = car.listingStatus === "sold" ? "SOLD" : (car.status || "Status not specified");
  if (car.listingStatus === "sold") status.classList.add("sold-label");
  card.appendChild(status);

  const title = document.createElement("h4");
  title.textContent =
    (car.manufacturer || "") + " " + (car.model || "Vehicle");
  card.appendChild(title);

  const price = document.createElement("p");
  price.className = "vehicle-price";
  price.textContent = formatPrice(car.price);
  card.appendChild(price);

  const details = document.createElement("p");
  details.className = "vehicle-details";

  const detailParts = [];

  if (car.year) detailParts.push(String(car.year));
  if (car.carType) detailParts.push(car.carType);
  if (car.fuel) detailParts.push(car.fuel);
  if (car.transmission) detailParts.push(car.transmission);

  details.textContent = detailParts.join(" • ");
  card.appendChild(details);

  if (car.mileage !== null && car.mileage !== undefined) {
    const mileage = document.createElement("p");
    mileage.textContent =
      "Mileage: " + Number(car.mileage).toLocaleString("en-KE") + " km";
    card.appendChild(mileage);
  }

  if (car.description) {
    const description = document.createElement("p");
    description.textContent = String(car.description);
    card.appendChild(description);
  }

  if (car.listingStatus === "sold") {
    const soldNotice = document.createElement("p");
    soldNotice.className = "sold-notice";
    soldNotice.textContent = "This vehicle has been marked as sold.";
    card.appendChild(soldNotice);
    return card;
  }

  const contactButton = document.createElement("button");
  contactButton.type = "button";
  contactButton.textContent = "Message Dealer Privately";

  contactButton.addEventListener("click", async () => {
    if (!car.id || !car.addedBy) {
      alert("This listing is missing seller details. Please try another vehicle.");
      return;
    }
    if (car.listingStatus === "sold") {
      alert("This vehicle has been marked as sold and cannot receive enquiries.");
      return;
    }

    const signedInUser = auth.currentUser;
    if (!signedInUser) {
      window.location.href = "buyer.html?car=" + encodeURIComponent(car.id);
      return;
    }

    try {
      const buyerSnap = await getDoc(doc(db, "buyers", signedInUser.uid));
      if (!buyerSnap.exists() || buyerSnap.data().role !== "buyer") {
        // A dealer/owner session cannot be used as a buyer account.
        // Send the visitor to the buyer registration/sign-in page instead of a popup.
        window.location.href = "buyer.html?car=" + encodeURIComponent(car.id) + "&mode=buyer";
        return;
      }

      const conversationId = signedInUser.uid + "_" + car.id;
      const conversationRef = doc(db, "conversations", conversationId);
      const existingConversation = await getDoc(conversationRef);
      if (!existingConversation.exists()) {
        await setDoc(conversationRef, {
          buyerId: signedInUser.uid,
          buyerName: buyerSnap.data().name || signedInUser.email || "Buyer",
          sellerId: car.addedBy,
          sellerName: car.sellerName || "Kiri Cars dealer",
          carId: car.id,
          carTitle: [(car.year || ""), (car.manufacturer || ""), (car.model || "")].filter(Boolean).join(" "),
          createdAt: serverTimestamp(),
          lastMessageAt: serverTimestamp(),
          lastMessage: "Enquiry started"
        });
      }
      window.location.href = "buyer.html?conversation=" + encodeURIComponent(conversationId);
    } catch (error) {
      console.error("Could not start private enquiry:", error);
      alert("We could not start your private enquiry (" + (error.code || "please try again") + "). If this continues, check the Kiri Cars Firestore rules.");
    }
  });

  card.appendChild(contactButton);

  // Keep the original WhatsApp option alongside private on-site messaging.
  const whatsappButton = document.createElement("button");
  whatsappButton.type = "button";
  whatsappButton.className = "secondary-mode";
  whatsappButton.textContent = "Contact via WhatsApp";
  whatsappButton.addEventListener("click", () => {
    const vehicleName =
      (car.manufacturer || "") + " " +
      (car.model || "") + " (" + (car.year || "Year not listed") + ")";
    const enquiry =
      "Hello, I am interested in " + vehicleName +
      ". Listed price: " + formatPrice(car.price) +
      ". Please share more details.";
    const sellerPhone = String(car.sellerWhatsApp || "").replace(/\D/g, "");
    if (!/^254[17]\d{8}$/.test(sellerPhone)) {
      alert("This seller has not added a valid WhatsApp number yet. Please try another vehicle.");
      return;
    }
    const whatsappUrl =
      "https://wa.me/" + sellerPhone + "?text=" + encodeURIComponent(enquiry);
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  });
  card.appendChild(whatsappButton);

  return card;
}

function applyFilters() {
  const search = searchInput.value.trim().toLowerCase();
  const manufacturer = manufacturerFilter.value;
  const carType = typeFilter.value;
  const year = yearFilter.value;
  const status = statusFilter.value;

  const minPrice =
    minPriceInput.value.trim() === ""
      ? null
      : Number(minPriceInput.value);

  const maxPrice =
    maxPriceInput.value.trim() === ""
      ? null
      : Number(maxPriceInput.value);

  const filteredCars = allCars.filter((car) => {
    if (!publicListingIsVisible(car)) return false;

    const searchableText = [
      car.manufacturer,
      car.model,
      car.carType,
      car.status,
      car.fuel,
      car.transmission,
      car.year
    ]
      .join(" ")
      .toLowerCase();

    if (search && !searchableText.includes(search)) {
      return false;
    }

    if (
      manufacturer &&
      String(car.manufacturer || "") !== manufacturer
    ) {
      return false;
    }

    if (carType && String(car.carType || "") !== carType) {
      return false;
    }

    if (year && String(car.year || "") !== year) {
      return false;
    }

    if (status && String(car.status || "") !== status) {
      return false;
    }

    const price = Number(car.price);

    if (minPrice !== null && price < minPrice) {
      return false;
    }

    if (maxPrice !== null && price > maxPrice) {
      return false;
    }

    return true;
  });

  renderCars(filteredCars);
}

function renderCars(cars) {
  carsGrid.replaceChildren();

  resultsCount.textContent =
    cars.length + (cars.length === 1 ? " vehicle found" : " vehicles found");

  if (cars.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent =
      allCars.filter(publicListingIsVisible).length === 0
        ? "No vehicles are currently available. Please check again later."
        : "No vehicles match those filters. Try changing your search.";

    carsGrid.appendChild(emptyMessage);
    return;
  }

  cars.forEach((car) => {
    carsGrid.appendChild(createVehicleCard(car));
  });
}

async function loadCars() {
  carsGrid.textContent = "Loading vehicle listings...";
  resultsCount.textContent = "Loading...";

  try {
    const snapshot = await getDocs(collection(db, "cars"));

    allCars = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    allCars.sort((a, b) => {
      const timeA = a.createdAt?.toMillis?.() || 0;
      const timeB = b.createdAt?.toMillis?.() || 0;
      return timeB - timeA;
    });

    prepareFilters();
    applyFilters();

  } catch (error) {
    console.error("Load public vehicles error:", error);

    carsGrid.replaceChildren();

    const errorMessage = document.createElement("p");
    errorMessage.textContent =
      "We could not load vehicle listings right now. Please check your connection and try again.";

    carsGrid.appendChild(errorMessage);
    resultsCount.textContent = "Listings unavailable";
  }
}

filterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  applyFilters();
});

filterForm.addEventListener("reset", () => {
  window.setTimeout(() => {
    applyFilters();
  }, 0);
});

searchInput.addEventListener("input", applyFilters);

manufacturerFilter.addEventListener("change", applyFilters);
typeFilter.addEventListener("change", applyFilters);
yearFilter.addEventListener("change", applyFilters);
statusFilter.addEventListener("change", applyFilters);
minPriceInput.addEventListener("input", applyFilters);
maxPriceInput.addEventListener("input", applyFilters);

loadCars();
