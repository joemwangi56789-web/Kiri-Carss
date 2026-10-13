import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
const message = document.getElementById("verificationMessage");
const params = new URLSearchParams(window.location.search);
const id = params.get("id");
const token = params.get("token");
if (!id || !token) {
  message.textContent = "This verification link is incomplete. Please use the link from your Kiri Cars email.";
  message.style.color = "#b42318";
} else {
  try {
    const verify = httpsCallable(getFunctions(app), "verifyEmailAlert");
    const result = await verify({ id, token });
    message.textContent = result.data.message;
    message.style.color = "#16864a";
    window.history.replaceState({}, "", "verify-alert.html");
  } catch (error) {
    message.textContent = error.message || "This verification link could not be used. It may have expired.";
    message.style.color = "#b42318";
  }
}
