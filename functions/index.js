const crypto = require("crypto");
const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const WHATSAPP_ACCESS_TOKEN = defineSecret("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID");
const SITE_URL = process.env.KIRI_SITE_URL || "https://kiricars.co.ke";
const GROUP_WINDOW_MS = 60 * 1000;
const MAX_RETRIES = 5;

function randomToken(bytes) { return crypto.randomBytes(bytes || 32).toString("hex"); }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function cleanText(value, max) { return String(value || "").trim().slice(0, max || 100); }
function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) digits = "254" + digits.slice(1);
  else if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) digits = "254" + digits;
  return /^254[17]\d{8}$/.test(digits) ? digits : "";
}
function cleanFilters(input) {
  const f = input && typeof input === "object" ? input : {};
  const result = {
    keyword: cleanText(f.keyword, 100),
    manufacturer: cleanText(f.manufacturer, 60),
    model: cleanText(f.model, 80),
    carType: cleanText(f.carType, 40),
    minYear: f.minYear === "" || f.minYear == null ? null : Number(f.minYear),
    maxYear: f.maxYear === "" || f.maxYear == null ? null : Number(f.maxYear),
    minPrice: f.minPrice === "" || f.minPrice == null ? null : Number(f.minPrice),
    maxPrice: f.maxPrice === "" || f.maxPrice == null ? null : Number(f.maxPrice),
    condition: cleanText(f.condition, 40),
    location: cleanText(f.location, 80)
  };
  for (const key of ["minYear", "maxYear"]) {
    if (result[key] !== null && (!Number.isInteger(result[key]) || result[key] < 1950 || result[key] > 2035)) throw new HttpsError("invalid-argument", "Enter a valid vehicle year.");
  }
  for (const key of ["minPrice", "maxPrice"]) {
    if (result[key] !== null && (!Number.isFinite(result[key]) || result[key] < 0 || result[key] > 1000000000)) throw new HttpsError("invalid-argument", "Enter a valid price.");
  }
  if (result.minYear !== null && result.maxYear !== null && result.minYear > result.maxYear) throw new HttpsError("invalid-argument", "Minimum year cannot exceed maximum year.");
  if (result.minPrice !== null && result.maxPrice !== null && result.minPrice > result.maxPrice) throw new HttpsError("invalid-argument", "Minimum price cannot exceed maximum price.");
  if (!Object.entries(result).some(([key, value]) => key !== "location" && value !== "" && value !== null)) throw new HttpsError("invalid-argument", "Choose at least one vehicle filter.");
  return result;
}
function isAvailable(car) {
  if (!car || ["draft", "suspended", "sold"].includes(String(car.listingStatus || "").toLowerCase())) return false;
  if (car.listingExpiresAt && typeof car.listingExpiresAt.toMillis === "function" && car.listingExpiresAt.toMillis() <= Date.now()) return false;
  return true;
}
function matchesSearch(car, search) {
  if (!isAvailable(car)) return false;
  const f = search.filters || {};
  if (f.keyword) {
    const haystack = [car.manufacturer, car.model, car.carType, car.status, car.fuel, car.transmission, car.year].join(" ").toLowerCase();
    if (!haystack.includes(f.keyword.toLowerCase())) return false;
  }
  if (f.manufacturer && cleanText(car.manufacturer, 60).toLowerCase() !== f.manufacturer.toLowerCase()) return false;
  if (f.model && cleanText(car.model, 80).toLowerCase() !== f.model.toLowerCase()) return false;
  if (f.carType && cleanText(car.carType, 40).toLowerCase() !== f.carType.toLowerCase()) return false;
  if (f.minYear !== null && f.minYear !== undefined && (!Number.isFinite(Number(car.year)) || Number(car.year) < Number(f.minYear))) return false;
  if (f.maxYear !== null && f.maxYear !== undefined && (!Number.isFinite(Number(car.year)) || Number(car.year) > Number(f.maxYear))) return false;
  if (f.minPrice !== null && f.minPrice !== undefined && (!Number.isFinite(Number(car.price)) || Number(car.price) < Number(f.minPrice))) return false;
  if (f.maxPrice !== null && f.maxPrice !== undefined && (!Number.isFinite(Number(car.price)) || Number(car.price) > Number(f.maxPrice))) return false;
  if (f.condition && cleanText(car.status, 40).toLowerCase() !== f.condition.toLowerCase()) return false;
  if (f.location && cleanText(car.location, 80).toLowerCase() !== f.location.toLowerCase()) return false;
  return true;
}
async function enqueueDelivery(searchId, search, carId, channel) {
  const deliveryId = hash(searchId + ":" + carId + ":" + channel).slice(0, 40);
  const deliveryRef = db.doc("alertDeliveries/" + deliveryId);
  await db.runTransaction(async function (tx) {
    const existing = await tx.get(deliveryRef);
    if (existing.exists) return;
    tx.set(deliveryRef, {
      searchId: searchId,
      carId: carId,
      channel: channel,
      status: "pending",
      attempts: 0,
      createdAt: Timestamp.now(),
      dueAt: Timestamp.fromMillis(Date.now() + GROUP_WINDOW_MS),
      ownerUid: search.ownerUid || null,
      isGuest: search.isGuest === true
    });
  });
}
async function queueCurrentMatches(searchId, search) {
  const cars = await db.collection("cars").get();
  for (const item of cars.docs) {
    const car = item.data();
    if (!matchesSearch(car, search)) continue;
    for (const channel of search.channels || []) await enqueueDelivery(searchId, search, item.id, channel);
  }
}
function listingUrl(carId) { return SITE_URL + "/index.html?car=" + encodeURIComponent(carId) + "#cars"; }
function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char];
  });
}
function carSummary(car) {
  return [car.year || "", car.manufacturer || "", car.model || ""].filter(Boolean).join(" ") +
    " — KSh " + (Number(car.price) > 0 ? Number(car.price).toLocaleString("en-KE") : "price on request");
}
async function enforceCreateRateLimit(request, isGuest) {
  const rawIp = request.rawRequest && (request.rawRequest.ip || request.rawRequest.headers["x-forwarded-for"]);
  const ip = cleanText(String(rawIp || "unknown").split(",")[0], 100);
  const identity = isGuest ? "guest:" + ip : "user:" + request.auth.uid;
  const hour = Math.floor(Date.now() / (60 * 60 * 1000));
  const ref = db.doc("alertRequestRateLimits/" + hash(identity).slice(0, 40));
  const maximum = isGuest ? 5 : 20;
  await db.runTransaction(async function (tx) {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const count = Number(data.hour) === hour ? Number(data.count || 0) : 0;
    if (count >= maximum) throw new HttpsError("resource-exhausted", "Too many saved-search requests. Please wait before trying again.");
    tx.set(ref, { hour: hour, count: count + 1, updatedAt: Timestamp.now() });
  });
}
function activateIfVerified(search) {
  const emailOk = !search.channels.includes("email") || search.emailVerified === true;
  const whatsappOk = !search.channels.includes("whatsapp") || search.whatsappVerified === true;
  return emailOk && whatsappOk ? "active" : "pending_verification";
}
async function sendEmail(to, subject, html, idempotencyKey) {
  const apiKey = RESEND_API_KEY.value();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const from = process.env.KIRI_EMAIL_FROM || "Kiri Cars <alerts@kiricars.co.ke>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey || hash(to + subject + html) },
    body: JSON.stringify({ from: from, to: [to], subject: subject, html: html })
  });
  const result = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error("Email provider error: " + (result.message || response.status));
  return result;
}
async function sendWhatsAppTemplate(to, templateName, parameters) {
  const token = WHATSAPP_ACCESS_TOKEN.value();
  const phoneNumberId = WHATSAPP_PHONE_NUMBER_ID.value();
  if (!token || !phoneNumberId || !templateName) throw new Error("WhatsApp Cloud API or approved template is not configured.");
  const response = await fetch("https://graph.facebook.com/v21.0/" + phoneNumberId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "template",
      template: {
        name: templateName,
        language: { code: process.env.KIRI_WHATSAPP_TEMPLATE_LANGUAGE || "en" },
        components: [{ type: "body", parameters: parameters.map(function (text) { return { type: "text", text: String(text).slice(0, 900) }; }) }]
      }
    })
  });
  const result = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error("WhatsApp provider error: " + (result.error && result.error.message || response.status));
  return result;
}
async function sendGuestVerificationEmail(id, email, rawVerifyToken, rawManageToken) {
  const verifyUrl = SITE_URL + "/verify-alert.html?id=" + encodeURIComponent(id) + "&token=" + encodeURIComponent(rawVerifyToken);
  const manageUrl = SITE_URL + "/manage-alert.html?id=" + encodeURIComponent(id) + "&token=" + encodeURIComponent(rawManageToken);
  const html = "<p>Confirm your Kiri Cars vehicle alert:</p><p><a href=\"" + verifyUrl + "\">Verify my alert</a></p><p>Manage, pause or cancel this saved search: <a href=\"" + manageUrl + "\">Manage alert</a></p><p>The verification link expires in 24 hours. If you did not request this, ignore this email.</p>";
  return sendEmail(email, "Verify your Kiri Cars vehicle alert", html, hash("verify:" + id));
}

exports.createSavedSearch = onCall({ secrets: [RESEND_API_KEY, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID] }, async function (request) {
  const input = request.data || {};
  const filters = cleanFilters(input.filters);
  const channels = Array.isArray(input.channels) ? Array.from(new Set(input.channels)) : [];
  if (!channels.length || channels.some(function (channel) { return channel !== "email" && channel !== "whatsapp"; })) throw new HttpsError("invalid-argument", "Choose email, WhatsApp, or both.");
  const isGuest = !request.auth;
  await enforceCreateRateLimit(request, isGuest);
  let email = cleanText(input.email, 254).toLowerCase();
  let whatsapp = normalizePhone(input.whatsapp);
  let emailVerified = false;
  let whatsappVerified = false;
  let ownerUid = null;
  if (!isGuest) {
    ownerUid = request.auth.uid;
    const buyerSnap = await db.doc("buyers/" + ownerUid).get();
    if (!buyerSnap.exists || buyerSnap.data().role !== "buyer") throw new HttpsError("permission-denied", "Sign in with a Kiri Cars buyer account.");
    if (channels.includes("email") || input.marketingOptIn === true) {
      email = cleanText(request.auth.token.email, 254).toLowerCase();
      emailVerified = request.auth.token.email_verified === true;
      if (!email || (channels.includes("email") && !emailVerified)) throw new HttpsError("failed-precondition", "Verify your account email before enabling email alerts.");
      if (input.marketingOptIn === true && !emailVerified) throw new HttpsError("failed-precondition", "Verify your account email before opting in to promotional emails.");
    } else email = "";
    if (channels.includes("whatsapp") && !whatsapp) throw new HttpsError("invalid-argument", "Enter a valid Kenyan WhatsApp number.");
    if (!channels.includes("whatsapp")) whatsapp = "";
  } else {
    if ((channels.includes("email") || input.marketingOptIn === true) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "Enter a valid email address for the selected alerts or promotional emails.");
    if (channels.includes("whatsapp") && !whatsapp) throw new HttpsError("invalid-argument", "Enter a valid Kenyan WhatsApp number.");
    if (!channels.includes("email") && input.marketingOptIn !== true) email = "";
    if (!channels.includes("whatsapp")) whatsapp = "";
  }
  if (channels.includes("email") && !RESEND_API_KEY.value()) throw new HttpsError("failed-precondition", "Email delivery is not configured yet.");
  if (channels.includes("whatsapp") && (!WHATSAPP_ACCESS_TOKEN.value() || !WHATSAPP_PHONE_NUMBER_ID.value() || !process.env.KIRI_WHATSAPP_VERIFY_TEMPLATE)) throw new HttpsError("failed-precondition", "WhatsApp verification is not configured yet.");

  const id = db.collection("savedSearches").doc().id;
  const verifyToken = isGuest && (channels.includes("email") || input.marketingOptIn === true) ? randomToken() : "";
  const manageToken = isGuest ? randomToken() : "";
  const code = channels.includes("whatsapp") ? String(crypto.randomInt(100000, 1000000)) : "";
  const now = Timestamp.now();
  const search = {
    ownerUid: ownerUid,
    isGuest: isGuest,
    filters: filters,
    channels: channels,
    email: email,
    whatsapp: whatsapp,
    emailVerified: emailVerified,
    whatsappVerified: whatsappVerified,
    status: activateIfVerified({ channels: channels, emailVerified: emailVerified, whatsappVerified: whatsappVerified }),
    marketingOptIn: input.marketingOptIn === true,
    marketingConsentAt: input.marketingOptIn === true ? now : null,
    createdAt: now,
    updatedAt: now,
    lastInteractionAt: now,
    reminderSentAt: null,
    reminderTokenHash: null,
    emailTokenHash: verifyToken ? hash(verifyToken) : null,
    emailTokenExpiresAt: verifyToken ? Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000) : null,
    whatsappCodeHash: code ? hash(code) : null,
    whatsappCodeExpiresAt: code ? Timestamp.fromMillis(Date.now() + 10 * 60 * 1000) : null,
    whatsappCodeAttempts: 0,
    manageTokenHash: manageToken ? hash(manageToken) : null,
    manageTokenCreatedAt: manageToken ? now : null
  };
  await db.doc("savedSearches/" + id).set(search);
  try {
    if (isGuest && (channels.includes("email") || input.marketingOptIn === true)) await sendGuestVerificationEmail(id, email, verifyToken, manageToken);
    if (channels.includes("whatsapp")) {
      const template = process.env.KIRI_WHATSAPP_VERIFY_TEMPLATE || "";
      const manageUrl = isGuest ? SITE_URL + "/manage-alert.html?id=" + id + "&token=" + manageToken : SITE_URL + "/saved-searches.html";
      await sendWhatsAppTemplate(whatsapp, template, [code, manageUrl]);
    }
  } catch (error) {
    await db.doc("savedSearches/" + id).update({ setupError: String(error.message || error).slice(0, 250) });
    throw new HttpsError("failed-precondition", "The request was recorded, but verification could not be sent. Please check Kiri Cars notification setup before trying again.");
  }
  return { id: id, status: search.status, needsEmailVerification: isGuest && (channels.includes("email") || input.marketingOptIn === true), needsWhatsAppVerification: channels.includes("whatsapp"), message: search.status === "active" ? "Saved search activated." : "Saved search created. Verify every selected contact channel before alerts can begin." };
});

exports.verifyEmailAlert = onCall(async function (request) {
  const id = cleanText(request.data && request.data.id, 100);
  const token = cleanText(request.data && request.data.token, 200);
  if (!id || !token) throw new HttpsError("invalid-argument", "The verification link is incomplete.");
  const ref = db.doc("savedSearches/" + id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "This alert request no longer exists.");
  const s = snap.data();
  if (!s.isGuest || !s.emailTokenHash || s.emailTokenHash !== hash(token)) throw new HttpsError("permission-denied", "This verification link is invalid or already used.");
  if (!s.emailTokenExpiresAt || s.emailTokenExpiresAt.toMillis() < Date.now()) throw new HttpsError("deadline-exceeded", "This verification link has expired. Create the alert again.");
  const status = activateIfVerified({ ...s, emailVerified: true });
  await ref.update({ emailVerified: true, emailTokenHash: null, emailTokenExpiresAt: null, status: status, updatedAt: Timestamp.now(), lastInteractionAt: Timestamp.now() });
  return { status: status, message: status === "active" ? "Email verified. Your saved search is active." : "Email verified. Verify your selected WhatsApp number before alerts can begin." };
});

exports.verifyWhatsAppAlert = onCall(async function (request) {
  const id = cleanText(request.data && request.data.id, 100);
  const code = cleanText(request.data && request.data.code, 10);
  if (!id || !/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the six-digit WhatsApp verification code.");
  const ref = db.doc("savedSearches/" + id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "This alert request no longer exists.");
  const s = snap.data();
  if (!s.channels.includes("whatsapp") || !s.whatsappCodeHash) throw new HttpsError("failed-precondition", "No WhatsApp verification is pending.");
  if (Number(s.whatsappCodeAttempts || 0) >= 5) throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Create a new alert request.");
  if (!s.whatsappCodeExpiresAt || s.whatsappCodeExpiresAt.toMillis() < Date.now()) throw new HttpsError("deadline-exceeded", "The WhatsApp code has expired. Create the alert again.");
  if (s.whatsappCodeHash !== hash(code)) {
    await ref.update({ whatsappCodeAttempts: FieldValue.increment(1) });
    throw new HttpsError("permission-denied", "That verification code is incorrect.");
  }
  const status = activateIfVerified({ ...s, whatsappVerified: true });
  await ref.update({ whatsappVerified: true, whatsappCodeHash: null, whatsappCodeExpiresAt: null, whatsappCodeAttempts: 0, status: status, updatedAt: Timestamp.now(), lastInteractionAt: Timestamp.now() });
  return { status: status, message: status === "active" ? "WhatsApp verified. Your saved search is active." : "WhatsApp verified. Verify your email before alerts can begin." };
});

exports.getGuestAlert = onCall(async function (request) {
  const id = cleanText(request.data && request.data.id, 100);
  const token = cleanText(request.data && request.data.token, 200);
  if (!id || !token) throw new HttpsError("invalid-argument", "The management link is incomplete.");
  const snap = await db.doc("savedSearches/" + id).get();
  if (!snap.exists) throw new HttpsError("not-found", "This saved search no longer exists.");
  const s = snap.data();
  if (!s.isGuest || !s.manageTokenHash || s.manageTokenHash !== hash(token)) throw new HttpsError("permission-denied", "This management link is invalid or has been revoked.");
  return {
    id: id, filters: s.filters, channels: s.channels, status: s.status,
    email: s.email ? s.email.replace(/^(.{1,2}).*(@.*)$/, "$1***$2") : "",
    whatsapp: s.whatsapp ? s.whatsapp.slice(0, 5) + "••••••" : "",
    marketingOptIn: s.marketingOptIn === true
  };
});

exports.manageGuestAlert = onCall(async function (request) {
  const id = cleanText(request.data && request.data.id, 100);
  const token = cleanText(request.data && request.data.token, 200);
  const action = cleanText(request.data && request.data.action, 20);
  if (!id || !token || !["pause", "resume", "delete", "marketing-off"].includes(action)) throw new HttpsError("invalid-argument", "Choose pause, resume, delete or stop promotional emails.");
  const ref = db.doc("savedSearches/" + id);
  const snap = await ref.get();
  if (!snap.exists) return { message: "This saved search has already been removed." };
  const s = snap.data();
  if (!s.isGuest || !s.manageTokenHash || s.manageTokenHash !== hash(token)) throw new HttpsError("permission-denied", "This management link is invalid or has been revoked.");
  if (action === "marketing-off") {
    const sameEmail = s.email ? await db.collection("savedSearches").where("email", "==", s.email).get() : null;
    if (sameEmail) {
      for (let offset = 0; offset < sameEmail.docs.length; offset += 400) {
        const batch = db.batch();
        sameEmail.docs.slice(offset, offset + 400).forEach(function (entry) {
          if (entry.data().marketingOptIn === true) batch.update(entry.ref, { marketingOptIn: false, updatedAt: Timestamp.now(), lastInteractionAt: Timestamp.now() });
        });
        await batch.commit();
      }
    } else {
      await ref.update({ marketingOptIn: false, updatedAt: Timestamp.now(), lastInteractionAt: Timestamp.now() });
    }
    return { message: "Promotional email consent has been withdrawn. Vehicle-availability alerts remain separate." };
  }
  if (action === "delete") {
    const deliveries = await db.collection("alertDeliveries").where("searchId", "==", id).get();
    const batch = db.batch();
    deliveries.docs.forEach(function (item) { batch.delete(item.ref); });
    batch.delete(ref);
    await batch.commit();
    return { message: "Saved search deleted. No further alerts will be sent." };
  }
  const status = action === "pause" ? "paused" : activateIfVerified(s);
  await ref.update({ status: status, updatedAt: Timestamp.now(), lastInteractionAt: Timestamp.now() });
  if (action === "resume" && status === "active") await queueCurrentMatches(id, { ...s, status: "active" });
  return { message: status === "paused" ? "Alerts paused." : status === "active" ? "Alerts resumed. Newly matching available vehicles will be checked." : "Verify every selected channel before alerts can resume." };
});

exports.claimGuestSearches = onCall(async function (request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to your Kiri Cars buyer account first.");
  if (request.auth.token.email_verified !== true || !request.auth.token.email) throw new HttpsError("failed-precondition", "Verify your buyer account email before claiming guest searches.");
  const buyer = await db.doc("buyers/" + request.auth.uid).get();
  if (!buyer.exists || buyer.data().role !== "buyer") throw new HttpsError("permission-denied", "A Kiri Cars buyer account is required.");
  const email = String(request.auth.token.email).toLowerCase();
  const guests = await db.collection("savedSearches").where("email", "==", email).get();
  const existingSnap = await db.collection("savedSearches").where("ownerUid", "==", request.auth.uid).get();
  const existingByKey = new Map(existingSnap.docs.map(function (docSnap) {
    const data = docSnap.data();
    return [JSON.stringify({ filters: data.filters || {}, channels: (data.channels || []).slice().sort() }), docSnap];
  }));
  let claimed = 0;
  for (const item of guests.docs) {
    const s = item.data();
    if (!s.isGuest || !s.emailVerified || s.ownerUid || s.status === "deleted") continue;
    const key = JSON.stringify({ filters: s.filters || {}, channels: (s.channels || []).slice().sort() });
    if (existingByKey.has(key)) {
      const existing = existingByKey.get(key);
      if (s.marketingOptIn === true && existing.data().marketingOptIn !== true) {
        await existing.ref.update({ marketingOptIn: true, marketingConsentAt: s.marketingConsentAt || Timestamp.now(), updatedAt: Timestamp.now() });
      }
      const deliveries = await db.collection("alertDeliveries").where("searchId", "==", item.id).get();
      for (let offset = 0; offset < deliveries.docs.length; offset += 400) {
        const batch = db.batch();
        deliveries.docs.slice(offset, offset + 400).forEach(function (delivery) { batch.delete(delivery.ref); });
        await batch.commit();
      }
      await item.ref.delete();
      continue;
    }
    await item.ref.update({ ownerUid: request.auth.uid, isGuest: false, manageTokenHash: null, manageTokenCreatedAt: null, updatedAt: Timestamp.now(), lastInteractionAt: Timestamp.now() });
    existingByKey.set(key, item);
    claimed += 1;
  }
  return { claimed: claimed, message: claimed ? "Transferred " + claimed + " verified guest search(es) to your account." : "No verified guest searches were found for your verified account email." };
});

exports.manageOwnedSavedSearch = onCall(async function (request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to manage saved searches.");
  const id = cleanText(request.data && request.data.id, 100);
  const action = cleanText(request.data && request.data.action, 20);
  if (!id || !["pause", "resume", "delete"].includes(action)) throw new HttpsError("invalid-argument", "Choose pause, resume or delete.");
  const buyer = await db.doc("buyers/" + request.auth.uid).get();
  if (!buyer.exists || buyer.data().role !== "buyer") throw new HttpsError("permission-denied", "A Kiri Cars buyer account is required.");
  const ref = db.doc("savedSearches/" + id);
  const snap = await ref.get();
  if (!snap.exists || snap.data().ownerUid !== request.auth.uid) throw new HttpsError("permission-denied", "You cannot manage that saved search.");
  const search = snap.data();
  if (action === "delete") {
    const deliveries = await db.collection("alertDeliveries").where("searchId", "==", id).get();
    for (let offset = 0; offset < deliveries.docs.length; offset += 400) {
      const batch = db.batch();
      deliveries.docs.slice(offset, offset + 400).forEach(function (item) { batch.delete(item.ref); });
      await batch.commit();
    }
    await ref.delete();
    return { message: "Saved search deleted. Pending alerts have been cancelled." };
  }
  const status = action === "pause" ? "paused" : activateIfVerified(search);
  await ref.update({ status: status, updatedAt: Timestamp.now(), lastInteractionAt: Timestamp.now() });
  if (action === "resume" && status === "active") await queueCurrentMatches(id, { ...search, status: "active" });
  return { message: status === "paused" ? "Alerts paused." : status === "active" ? "Alerts resumed. Newly matching available vehicles will be checked." : "Verify every selected contact channel before alerts can resume." };
});

exports.onCarListingChanged = onDocumentWritten("cars/{carId}", async function (event) {
  const after = event.data && event.data.after;
  if (!after || !after.exists) return;
  const car = after.data();
  if (!isAvailable(car)) return;
  const searches = await db.collection("savedSearches").where("status", "==", "active").get();
  const carId = event.params.carId;
  for (const item of searches.docs) {
    const search = item.data();
    if (!matchesSearch(car, search)) continue;
    for (const channel of search.channels || []) await enqueueDelivery(item.id, search, carId, channel);
  }
});

exports.processPendingAlerts = onSchedule({
  schedule: "every 1 minutes",
  timeZone: "Africa/Nairobi",
  secrets: [RESEND_API_KEY, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID]
}, async function () {
  const pending = await db.collection("alertDeliveries").where("status", "==", "pending").limit(500).get();
  const staleSending = await db.collection("alertDeliveries").where("status", "==", "sending").limit(500).get();
  for (const stale of staleSending.docs) {
    const data = stale.data();
    if (data.sendingAt && data.sendingAt.toMillis() < Date.now() - 5 * 60 * 1000) {
      await stale.ref.update({ status: "pending", dueAt: Timestamp.now(), lastError: "Recovered a stale sending lease." });
    }
  }
  const groups = new Map();
  for (const item of pending.docs) {
    const delivery = item.data();
    if (!delivery.dueAt || delivery.dueAt.toMillis() > Date.now()) continue;
    const claimed = await db.runTransaction(async function (tx) {
      const latest = await tx.get(item.ref);
      if (!latest.exists || latest.data().status !== "pending" || latest.data().dueAt.toMillis() > Date.now()) return false;
      tx.update(item.ref, { status: "sending", sendingAt: Timestamp.now() });
      return true;
    });
    if (!claimed) continue;
    const searchSnap = await db.doc("savedSearches/" + delivery.searchId).get();
    const carSnap = await db.doc("cars/" + delivery.carId).get();
    if (!searchSnap.exists || !carSnap.exists || searchSnap.data().status !== "active" || !matchesSearch(carSnap.data(), searchSnap.data())) {
      await item.ref.update({ status: "cancelled", finishedAt: Timestamp.now(), lastError: "Search or vehicle is no longer eligible." });
      continue;
    }
    const s = searchSnap.data();
    const channel = delivery.channel;
    const recipient = channel === "email" ? s.email : s.whatsapp;
    const verified = channel === "email" ? s.emailVerified === true : s.whatsappVerified === true;
    if (!recipient || !verified) {
      await item.ref.update({ status: "cancelled", finishedAt: Timestamp.now(), lastError: "The selected channel is not verified." });
      continue;
    }
    const key = channel + ":" + recipient;
    if (!groups.has(key)) groups.set(key, { channel: channel, recipient: recipient, items: [] });
    groups.get(key).items.push({ ref: item.ref, delivery: delivery, car: carSnap.data(), carId: delivery.carId });
  }
  for (const group of groups.values()) {
    const cars = Array.from(new Map(group.items.map(function (item) { return [item.carId, item]; })).values()).slice(0, 8);
    const summaries = cars.map(function (item) { return carSummary(item.car); });
    const idempotencyKey = hash(group.items.map(function (item) { return item.ref.id; }).sort().join("|"));
    try {
      if (group.channel === "email") {
        const rows = cars.map(function (item) {
          return "<li><strong>" + escapeHtml(carSummary(item.car)) + "</strong> — <a href=\"" + listingUrl(item.carId) + "\">View this vehicle</a></li>";
        }).join("");
        await sendEmail(group.recipient, cars.length === 1 ? "A car matching your Kiri Cars search is available" : "Cars matching your Kiri Cars searches are available",
          "<p>New vehicles match your saved search:</p><ul>" + rows + "</ul><p>Manage searches at <a href=\"" + SITE_URL + "/saved-searches.html\">Kiri Cars saved searches</a>.</p>", idempotencyKey);
      } else {
        const template = process.env.KIRI_WHATSAPP_ALERT_TEMPLATE || "";
        if (!template) throw new Error("Set KIRI_WHATSAPP_ALERT_TEMPLATE to an approved WhatsApp alert template.");
        await sendWhatsAppTemplate(group.recipient, template, [summaries.join("; "), cars.length === 1 ? listingUrl(cars[0].carId) : SITE_URL + "/index.html#cars"]);
      }
      for (const item of group.items) await item.ref.update({ status: "sent", sentAt: Timestamp.now(), providerAccepted: true, attempts: FieldValue.increment(1) });
    } catch (error) {
      for (const item of group.items) {
        const attempts = Number(item.delivery.attempts || 0) + 1;
        const terminal = attempts >= MAX_RETRIES;
        await item.ref.update({
          status: terminal ? "failed" : "pending",
          attempts: attempts,
          dueAt: Timestamp.fromMillis(Date.now() + Math.min(60, Math.pow(2, attempts)) * 60 * 1000),
          lastError: String(error.message || error).slice(0, 300),
          lastAttemptAt: Timestamp.now()
        });
      }
    }
  }
});


exports.unsubscribeMarketing = onCall(async function (request) {
  const key = cleanText(request.data && request.data.key, 100);
  const token = cleanText(request.data && request.data.token, 200);
  if (!key || !token) throw new HttpsError("invalid-argument", "The unsubscribe link is incomplete.");
  const ref = db.doc("marketingUnsubscribeTokens/" + key);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "This unsubscribe link is invalid or expired.");
  const data = snap.data();
  const tokenHash = hash(token);
  const validHashes = Array.isArray(data.tokenHashes) ? data.tokenHashes : [];
  if (!validHashes.includes(tokenHash) || (data.expiresAt && data.expiresAt.toMillis() < Date.now())) {
    throw new HttpsError("permission-denied", "This unsubscribe link is invalid or expired.");
  }
  const matches = await db.collection("savedSearches").where("email", "==", data.email).get();
  for (let offset = 0; offset < matches.docs.length; offset += 400) {
    const batch = db.batch();
    matches.docs.slice(offset, offset + 400).forEach(function (item) {
      if (item.data().marketingOptIn === true) batch.update(item.ref, { marketingOptIn: false, updatedAt: Timestamp.now(), lastInteractionAt: Timestamp.now() });
    });
    await batch.commit();
  }
  await ref.update({ usedAt: Timestamp.now() });
  return { message: "You have been unsubscribed from Kiri Cars promotional emails. Vehicle-availability alerts remain separate." };
});

exports.weeklyPromotionalEmail = onSchedule({
  schedule: "every monday 09:00",
  timeZone: "Africa/Nairobi",
  secrets: [RESEND_API_KEY]
}, async function () {
  const allSearches = await db.collection("savedSearches").where("status", "==", "active").get();
  const byEmail = new Map();
  for (const item of allSearches.docs) {
    const s = item.data();
    if (s.marketingOptIn !== true || s.emailVerified !== true || !s.email) continue;
    if (!byEmail.has(s.email)) byEmail.set(s.email, []);
    byEmail.get(s.email).push(s);
  }
  if (!byEmail.size) return;
  const carsSnap = await db.collection("cars").get();
  const cars = carsSnap.docs.map(function (item) { return { id: item.id, ...item.data() }; }).filter(isAvailable);
  const weekKey = new Date().toISOString().slice(0, 10);
  for (const [email, searches] of byEmail.entries()) {
    const relevant = cars.filter(function (car) {
      return searches.some(function (search) { return matchesSearch(car, search); });
    }).slice(0, 8);
    if (!relevant.length) continue;
    const key = hash(email + ":" + weekKey).slice(0, 40);
    const tokenRef = db.doc("marketingUnsubscribeTokens/" + key);
    const existing = await tokenRef.get();
    if (existing.exists && existing.data().sentAt) continue;
    const rawToken = randomToken();
    const previousHashes = existing.exists && Array.isArray(existing.data().tokenHashes) ? existing.data().tokenHashes : [];
    await tokenRef.set({
      email: email,
      tokenHashes: Array.from(new Set(previousHashes.concat([hash(rawToken)]))),
      campaignKey: weekKey,
      expiresAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
      updatedAt: Timestamp.now()
    }, { merge: true });
    const rows = relevant.map(function (car) {
      return "<li><strong>" + escapeHtml(carSummary(car)) + "</strong> — <a href=\"" + SITE_URL + "/index.html?car=" + encodeURIComponent(car.id) + "#cars\">View vehicle</a></li>";
    }).join("");
    const unsubscribeUrl = SITE_URL + "/manage-marketing.html?key=" + key + "&token=" + encodeURIComponent(rawToken);
    try {
      await sendEmail(email, "Your weekly Kiri Cars vehicle digest",
        "<p>Here are vehicles relevant to your saved searches this week.</p><ul>" + rows + "</ul><p>Promotional emails are optional. <a href=\"" + unsubscribeUrl + "\">Unsubscribe from promotional emails</a>. Your separate saved-search alerts will remain active.</p>",
        hash("weekly:" + email + ":" + weekKey + ":" + rawToken));
      await tokenRef.update({ sentAt: Timestamp.now() });
    } catch (error) {
      console.error("Weekly promotional email failed for recipient hash " + hash(email).slice(0, 12), error.message);
    }
  }
});

exports.confirmGuestAlert = onCall(async function (request) {
  const id = cleanText(request.data && request.data.id, 100);
  const token = cleanText(request.data && request.data.token, 200);
  if (!id || !token) throw new HttpsError("invalid-argument", "The confirmation link is incomplete.");
  const ref = db.doc("savedSearches/" + id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "This saved search no longer exists.");
  const s = snap.data();
  if (!s.isGuest || !s.reminderTokenHash || s.reminderTokenHash !== hash(token)) throw new HttpsError("permission-denied", "This confirmation link is invalid or already used.");
  if (!s.reminderTokenExpiresAt || s.reminderTokenExpiresAt.toMillis() < Date.now()) throw new HttpsError("deadline-exceeded", "The confirmation period has expired. You can create a new saved search.");
  const status = activateIfVerified(s);
  await ref.update({
    status: status,
    reminderSentAt: null,
    reminderTokenHash: null,
    reminderTokenExpiresAt: null,
    updatedAt: Timestamp.now(),
    lastInteractionAt: Timestamp.now()
  });
  return { message: status === "active" ? "Thank you. Your saved-search alerts remain active." : "Your search is confirmed, but all selected contact channels must be verified before alerts can resume." };
});

exports.maintainInactiveGuestAlerts = onSchedule({
  schedule: "every day 03:15",
  timeZone: "Africa/Nairobi",
  secrets: [RESEND_API_KEY, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID]
}, async function () {
  const guests = await db.collection("savedSearches").where("isGuest", "==", true).get();
  const now = Date.now();
  const sixMonthsMs = 183 * 24 * 60 * 60 * 1000;
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  for (const item of guests.docs) {
    const s = item.data();
    if (s.status !== "active") continue;
    if (s.reminderSentAt && s.reminderTokenExpiresAt && s.reminderTokenExpiresAt.toMillis() <= now) {
      await item.ref.update({ status: "paused", pausedReason: "inactive_guest_no_confirmation", updatedAt: Timestamp.now() });
      continue;
    }
    if (s.reminderSentAt) continue;
    const lastInteraction = s.lastInteractionAt && s.lastInteractionAt.toMillis ? s.lastInteractionAt.toMillis() : (s.createdAt && s.createdAt.toMillis ? s.createdAt.toMillis() : now);
    if (now - lastInteraction < sixMonthsMs) continue;
    const token = randomToken();
    const confirmUrl = SITE_URL + "/confirm-alert.html?id=" + item.id + "&token=" + encodeURIComponent(token);
    let sent = false;
    try {
      if (s.email && s.emailVerified && (s.channels || []).includes("email")) {
        await sendEmail(s.email, "Do you still want Kiri Cars alerts?",
          "<p>Your saved search has been active for six months without interaction. Confirm within 14 days to keep receiving alerts.</p><p><a href=\"" + confirmUrl + "\">Keep my alerts active</a></p><p>If you do not confirm, your search will be paused. You can reactivate it later.</p>",
          hash("inactive-reminder:" + item.id + ":" + Math.floor(now / fourteenDaysMs)));
        sent = true;
      }
      if (s.whatsapp && s.whatsappVerified && (s.channels || []).includes("whatsapp") && process.env.KIRI_WHATSAPP_INACTIVITY_TEMPLATE) {
        await sendWhatsAppTemplate(s.whatsapp, process.env.KIRI_WHATSAPP_INACTIVITY_TEMPLATE, [confirmUrl]);
        sent = true;
      }
    } catch (error) {
      console.error("Inactive guest reminder failed for alert " + item.id, error.message);
    }
    if (sent) {
      await item.ref.update({
        reminderSentAt: Timestamp.now(),
        reminderTokenHash: hash(token),
        reminderTokenExpiresAt: Timestamp.fromMillis(now + fourteenDaysMs)
      });
    }
  }
});
