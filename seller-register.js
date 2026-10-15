import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const form = document.getElementById("sellerRegisterForm");
const sellerType = document.getElementById("sellerType");
const businessNameGroup = document.getElementById("businessNameGroup");
const businessNameInput = document.getElementById("businessName");
const button = document.getElementById("sellerRegisterButton");
const message = document.getElementById("sellerRegisterMessage");

function showMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#c62828" : "#167a35";
}

function normalizeKenyanPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) digits = "254" + digits.slice(1);
  else if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) digits = "254" + digits;
  return /^254[17]\d{8}$/.test(digits) ? digits : "";
}

sellerType.addEventListener("change", () => {
  const isDealership = sellerType.value === "dealership";
  businessNameGroup.hidden = !isDealership;
  businessNameInput.required = isDealership;
  if (!isDealership) businessNameInput.value = "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("sellerName").value.trim();
  const type = sellerType.value;
  const businessName = businessNameInput.value.trim();
  const email = document.getElementById("sellerEmail").value.trim().toLowerCase();
  const whatsapp = normalizeKenyanPhone(document.getElementById("sellerWhatsApp").value);
  const password = document.getElementById("sellerPassword").value;
  const confirmPassword = document.getElementById("sellerPasswordConfirm").value;

  if (!whatsapp) {
    showMessage("Enter a valid Kenyan mobile number, e.g. 0712345678 or 254712345678.", true);
    return;
  }
  if (type !== "dealership" && type !== "broker") {
    showMessage("Choose showroom representative or independent sales representative.", true);
    return;
  }
  if (type === "dealership" && !businessName) {
    showMessage("Enter your showroom or business name.", true);
    return;
  }
  if (password !== confirmPassword) {
    showMessage("The passwords do not match.", true);
    return;
  }

  button.disabled = true;
  button.textContent = "Creating account...";
  showMessage("Registering your seller account...");

  let createdUser = null;
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    createdUser = credential.user;

    await setDoc(doc(db, "admins", createdUser.uid), {
      name,
      email,
      role: "dealer",
      active: true,
      approvalStatus: "approved",
      verificationStatus: "pending",
      sellerType: type,
      businessName: type === "dealership" ? businessName : "",
      whatsapp,
      createdAt: serverTimestamp(),
      createdBy: createdUser.uid
    });

    showMessage("Your seller account is ready. You can sign in and start listing vehicles. Kiri Cars may still verify your business details.");
    form.reset();
    businessNameGroup.hidden = true;
    await signOut(auth);
    window.setTimeout(() => { window.location.href = "login.html"; }, 1800);
  } catch (error) {
    console.error("Seller registration failed:", error);
    if (createdUser) {
      showMessage("Your login account was created, but the seller profile could not be saved. Contact Kiri Cars support before registering again. Error: " + (error.code || error.message), true);
    } else if (error.code === "auth/email-already-in-use") {
      showMessage("That email already has an account. Please sign in instead.", true);
    } else if (error.code === "auth/weak-password") {
      showMessage("Choose a stronger password with at least 6 characters.", true);
    } else {
      showMessage("Could not complete registration: " + (error.code || error.message), true);
    }
  } finally {
    button.disabled = false;
    button.textContent = "Create Seller Account";
  }
});
