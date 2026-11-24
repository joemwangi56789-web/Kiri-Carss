import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const TERMS_VERSION = "2026-11-07";
const consent = document.getElementById("termsConsent");
const button = document.getElementById("acceptTermsButton");
const message = document.getElementById("termsMessage");
const params = new URLSearchParams(location.search);
const requestedReturn = params.get("return");
const allowedReturns = ["story-editor.html", "stories.html", "index.html", "owner.html", "admin.html", "buyer.html?mode=buyer"];
const returnTo = allowedReturns.includes(requestedReturn) ? requestedReturn : "story-editor.html";
let currentUser = null;
let profileCollection = "";
let profile = null;
let checking = false;

function say(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#b42318" : "#174a88";
}

onAuthStateChanged(auth, async (user) => {
  if (checking) return;
  checking = true;
  currentUser = user;
  if (!user) {
    say("Please sign in first, then return here to accept the Terms.", true);
    checking = false;
    return;
  }
  try {
    let snap = await getDoc(doc(db, "buyers", user.uid));
    if (snap.exists()) {
      profileCollection = "buyers";
      profile = snap.data();
    } else {
      snap = await getDoc(doc(db, "admins", user.uid));
      if (snap.exists()) {
        profileCollection = "admins";
        profile = snap.data();
      }
    }
    if (!profile) {
      say("We could not find a Kiri Cars account profile for this login.", true);
      button.disabled = true;
    } else if (profile.active === false || ["suspended", "banned"].includes(profile.accountStatus)) {
      say("This account is not active and cannot accept publishing permissions.", true);
      button.disabled = true;
    } else if (profile.termsAccepted === true && profile.termsVersion === TERMS_VERSION) {
      say("Your account has already accepted the current Terms. Continuing…");
      window.location.replace(returnTo);
    } else {
      say("Your account is signed in. Review the documents, tick the box and accept to continue.");
      button.disabled = false;
    }
  } catch (error) {
    console.error(error);
    say("Could not check your account permissions: " + (error.code || error.message), true);
  } finally {
    checking = false;
  }
});

consent.addEventListener("change", () => {
  button.disabled = !consent.checked || !currentUser || !profile;
});

button.addEventListener("click", async () => {
  if (!currentUser || !profile || !consent.checked) return;
  button.disabled = true;
  say("Saving your acceptance…");
  try {
    await updateDoc(doc(db, profileCollection, currentUser.uid), {
      termsAccepted: true,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: serverTimestamp()
    });
    say("Acceptance saved. Returning to Kiri Stories…");
    window.location.replace(returnTo);
  } catch (error) {
    console.error(error);
    say("Could not save your acceptance: " + (error.code || error.message), true);
    button.disabled = false;
  }
});
