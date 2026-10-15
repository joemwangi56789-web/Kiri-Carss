import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
const message = document.getElementById("marketingMessage");
const button = document.getElementById("unsubscribeMarketingButton");
const params = new URLSearchParams(window.location.search);
const key = params.get("key");
const token = params.get("token");
if (!key || !token) {
  message.textContent = "This unsubscribe link is incomplete. Open the full link from your Kiri Cars promotional email.";
  message.style.color = "#b42318";
  button.disabled = true;
} else {
  button.addEventListener("click", async () => {
    button.disabled = true;
    message.textContent = "Updating your promotional email preference...";
    try {
      const unsubscribe = httpsCallable(getFunctions(app), "unsubscribeMarketing");
      const result = await unsubscribe({ key, token });
      message.textContent = result.data.message;
      message.style.color = "#16864a";
      window.history.replaceState({}, "", "manage-marketing.html");
    } catch (error) {
      message.textContent = error.message || "Could not update your preference.";
      message.style.color = "#b42318";
      button.disabled = false;
    }
  });
}
