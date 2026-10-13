import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
const message = document.getElementById("confirmAlertMessage");
const button = document.getElementById("confirmAlertButton");
const params = new URLSearchParams(window.location.search);
const id = params.get("id");
const token = params.get("token");
if (!id || !token) {
  message.textContent = "This confirmation link is incomplete.";
  message.style.color = "#b42318";
  button.disabled = true;
} else {
  button.addEventListener("click", async () => {
    button.disabled = true;
    message.textContent = "Confirming your saved search...";
    try {
      const confirmAlert = httpsCallable(getFunctions(app), "confirmGuestAlert");
      const result = await confirmAlert({ id, token });
      message.textContent = result.data.message;
      message.style.color = "#16864a";
      window.history.replaceState({}, "", "confirm-alert.html");
    } catch (error) {
      message.textContent = error.message || "Could not confirm this alert.";
      message.style.color = "#b42318";
      button.disabled = false;
    }
  });
}
