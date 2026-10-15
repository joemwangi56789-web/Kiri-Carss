import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-functions.js";
const message = document.getElementById("manageAlertMessage");
const details = document.getElementById("manageAlertDetails");
const actions = document.getElementById("manageAlertActions");
const params = new URLSearchParams(window.location.search);
const id = params.get("id");
const token = params.get("token");
const functions = getFunctions(app);
const getGuestAlert = httpsCallable(functions, "getGuestAlert");
const manageGuestAlert = httpsCallable(functions, "manageGuestAlert");
let currentStatus = "";
function setMessage(text, error) { message.textContent = text; message.style.color = error ? "#b42318" : "#16864a"; }
async function refresh() {
  const result = await getGuestAlert({ id, token });
  const alert = result.data;
  currentStatus = alert.status;
  details.replaceChildren();
  const filters = document.createElement("p");
  filters.textContent = Object.entries(alert.filters || {}).filter(([key, value]) => value !== "" && value !== null).map(([key, value]) => key + ": " + value).join(" · ");
  const status = document.createElement("p");
  status.textContent = "Status: " + String(alert.status).replaceAll("_", " ");
  const contacts = document.createElement("p");
  contacts.textContent = "Verified contact channels: " + (alert.channels || []).join(", ") + (alert.email ? " · " + alert.email : "") + (alert.whatsapp ? " · " + alert.whatsapp : "");
  details.append(filters, status, contacts);
  details.hidden = false;
  actions.hidden = false;
  document.getElementById("pauseAlertButton").hidden = alert.status === "paused";
  document.getElementById("resumeAlertButton").hidden = alert.status === "active";
}
async function runAction(action) {
  const buttons = Array.from(actions.querySelectorAll("button"));
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await manageGuestAlert({ id, token, action });
    setMessage(result.data.message);
    if (action === "delete") {
      details.hidden = true;
      actions.hidden = true;
    } else await refresh();
  } catch (error) {
    setMessage(error.message || "Could not update this alert.", true);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}
document.getElementById("pauseAlertButton").addEventListener("click", () => runAction("pause"));
document.getElementById("resumeAlertButton").addEventListener("click", () => runAction("resume"));
document.getElementById("deleteAlertButton").addEventListener("click", () => {
  if (confirm("Delete this saved search permanently? No further alerts will be sent.")) runAction("delete");
});
document.getElementById("stopMarketingButton").addEventListener("click", () => runAction("marketing-off"));
if (!id || !token) setMessage("This management link is incomplete. Open the full link from your Kiri Cars email or WhatsApp.", true);
else refresh().catch((error) => setMessage(error.message || "This management link is invalid or expired.", true));
