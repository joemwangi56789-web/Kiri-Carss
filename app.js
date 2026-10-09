
import { db } from "./firebase-config.js";

import {
  collection,
  getDocs
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

  const imageUrl = safeImageUrl(car.imageUrl);

  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = (car.manufacturer || "") + " " + (car.model || "vehicle");
    image.loading = "lazy";

    image.onerror = () => {
      image.remove();
    };

    card.appendChild(image);
  }

  const status = document.createElement("span");
  status.className = "status-tag";
  status.textContent = car.status || "Status not specified";
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

  const contactButton = document.createElement("button");
  contactButton.type = "button";
  contactButton.textContent = "Enquire About This Car";

  contactButton.addEventListener("click", () => {
    const vehicleName =
      (car.manufacturer || "") + " " +
      (car.model || "") + " (" + (car.year || "Year not listed") + ")";

    const enquiry =
      "Hello Kiri Cars, I am interested in " +
      vehicleName +
      ". Listed price: " +
      formatPrice(car.price) +
      ". Please share more details.";

    const whatsappUrl =
      "https://wa.me/?text=" + encodeURIComponent(enquiry);

    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  });

  card.appendChild(contactButton);

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
      allCars.length === 0
        ? "No vehicles are listed yet. Please check again later."
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
