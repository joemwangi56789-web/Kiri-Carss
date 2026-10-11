import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const authPanel = document.getElementById("authPanel");
const inboxPanel = document.getElementById("inboxPanel");
const authTitle = document.getElementById("authTitle");
const buyerAuthForm = document.getElementById("buyerAuthForm");
const buyerNameInput = document.getElementById("buyerName");
const buyerEmailInput = document.getElementById("buyerEmail");
const buyerPasswordInput = document.getElementById("buyerPassword");
const nameField = document.getElementById("nameField");
const buyerAuthButton = document.getElementById("buyerAuthButton");
const buyerAuthMessage = document.getElementById("buyerAuthMessage");
const showSignup = document.getElementById("showSignup");
const showLogin = document.getElementById("showLogin");
const buyerSignOut = document.getElementById("buyerSignOut");
const accountWelcome = document.getElementById("accountWelcome");
const accountRoleNote = document.getElementById("accountRoleNote");
const buyerPageMessage = document.getElementById("buyerPageMessage");
const conversationList = document.getElementById("conversationList");
const threadTitle = document.getElementById("threadTitle");
const messageStream = document.getElementById("messageStream");
const messageForm = document.getElementById("messageForm");
const messageText = document.getElementById("messageText");
const sendMessageButton = document.getElementById("sendMessageButton");
const refreshInbox = document.getElementById("refreshInbox");

let authMode = "signup";
let currentUser = null;
let currentProfile = null;
let currentRole = "";
let selectedConversationId = "";
let conversationCache = [];
let loadingSession = false;
let creatingBuyer = false;

function setMessage(element, text, isError = false) {
  element.textContent = text || "";
  element.style.color = isError ? "#b42318" : "#16864a";
}

function formatTime(value) {
  let date = null;
  if (value && typeof value.toDate === "function") date = value.toDate();
  else if (value && typeof value.seconds === "number") date = new Date(value.seconds * 1000);
  if (!date) return "";
  return date.toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" });
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  nameField.hidden = !signup;
  buyerNameInput.required = signup;
  buyerPasswordInput.autocomplete = signup ? "new-password" : "current-password";
  authTitle.textContent = signup ? "Create your buyer account" : "Sign in to Kiri Cars";
  buyerAuthButton.textContent = signup ? "Create Buyer Account" : "Sign In";
  showSignup.classList.toggle("secondary-mode", !signup);
  showLogin.classList.toggle("secondary-mode", signup);
  setMessage(buyerAuthMessage, "");
}

showSignup.addEventListener("click", () => setAuthMode("signup"));
showLogin.addEventListener("click", () => setAuthMode("login"));

buyerAuthForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  buyerAuthButton.disabled = true;
  const email = buyerEmailInput.value.trim();
  const password = buyerPasswordInput.value;
  try {
    if (authMode === "signup") {
      const name = buyerNameInput.value.trim();
      if (name.length < 2) {
        setMessage(buyerAuthMessage, "Please enter your name.", true);
        return;
      }
      creatingBuyer = true;
      setMessage(buyerAuthMessage, "Creating your secure buyer account...");
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "buyers", result.user.uid), {
        name,
        email,
        role: "buyer",
        createdAt: serverTimestamp()
      });
      creatingBuyer = false;
      await loadSession(result.user);
    } else {
      setMessage(buyerAuthMessage, "Signing in...");
      const result = await signInWithEmailAndPassword(auth, email, password);
      await loadSession(result.user);
    }
  } catch (error) {
    creatingBuyer = false;
    console.error("Buyer authentication failed:", error);
    const errors = {
      "auth/email-already-in-use": "That email already has an account. Choose Sign In instead.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/weak-password": "Choose a password with at least 6 characters.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/too-many-requests": "Too many attempts. Please wait and try again.",
      "permission-denied": "Firestore blocked the account profile operation. The Phase 3 security rules must be published."
    };
    setMessage(buyerAuthMessage, errors[error.code] || ("Could not complete this step: " + (error.code || error.message)), true);
  } finally {
    buyerAuthButton.disabled = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  if (creatingBuyer || loadingSession) return;
  if (!user) {
    currentUser = null;
    currentProfile = null;
    currentRole = "";
    authPanel.hidden = false;
    inboxPanel.hidden = true;
    buyerSignOut.hidden = true;
    return;
  }
  await loadSession(user);
});

async function loadSession(user) {
  if (loadingSession) return;
  loadingSession = true;
  try {
    const buyerSnap = await getDoc(doc(db, "buyers", user.uid));
    if (buyerSnap.exists() && buyerSnap.data().role === "buyer") {
      currentUser = user;
      currentProfile = buyerSnap.data();
      currentRole = "buyer";
    } else {
      const params = new URLSearchParams(window.location.search);
      const buyerModeRequested = params.get("mode") === "buyer" || Boolean(params.get("car"));
      if (buyerModeRequested) {
        // The same Firebase session cannot act as both dealer and buyer.
        // Sign out the dealer session so the buyer registration form remains visible.
        await signOut(auth);
        currentUser = null;
        currentProfile = null;
        currentRole = "";
        authPanel.hidden = false;
        inboxPanel.hidden = true;
        buyerSignOut.hidden = true;
        setAuthMode("signup");
        setMessage(buyerAuthMessage, "To contact a dealer, create or sign in to a buyer account. Your dealer session has been signed out on this device.", false);
        return;
      }

      const adminSnap = await getDoc(doc(db, "admins", user.uid));
      const admin = adminSnap.exists() ? adminSnap.data() : null;
      if (admin && admin.active === true && (admin.role === "admin" || admin.role === "owner")) {
        currentUser = user;
        currentProfile = admin;
        currentRole = admin.role;
      } else {
        currentUser = null;
        currentProfile = null;
        currentRole = "";
        authPanel.hidden = false;
        inboxPanel.hidden = true;
        setMessage(buyerAuthMessage, "This page needs a buyer account. Please create one or sign in.", true);
        return;
      }
    }

    authPanel.hidden = true;
    inboxPanel.hidden = false;
    buyerSignOut.hidden = false;
    accountWelcome.textContent = "Welcome, " + (currentProfile.name || user.email || "Kiri Cars user");
    accountRoleNote.textContent = currentRole === "buyer"
      ? "Your private enquiries. Only you and the relevant dealer can access these conversations."
      : "Dealer inbox: private enquiries about your vehicles.";
    await loadConversations();

    const params = new URLSearchParams(window.location.search);
    const carId = params.get("car");
    const conversationId = params.get("conversation");
    if (carId && currentRole === "buyer") {
      await startConversation(carId);
    } else if (conversationId) {
      await openConversation(conversationId);
    }
  } catch (error) {
    console.error("Could not load account:", error);
    if (!currentUser) authPanel.hidden = false;
    setMessage(currentRole ? buyerPageMessage : buyerAuthMessage,
      "Could not load your account or messages: " + (error.code || error.message), true);
  } finally {
    loadingSession = false;
  }
}

async function startConversation(carId) {
  if (!currentUser || currentRole !== "buyer") {
    setMessage(buyerPageMessage, "Sign in with a buyer account to contact a dealer.", true);
    return;
  }
  try {
    const carSnap = await getDoc(doc(db, "cars", carId));
    if (!carSnap.exists()) {
      setMessage(buyerPageMessage, "This vehicle listing could not be found.", true);
      return;
    }
    const car = carSnap.data();
    if (car.listingStatus === "sold") {
      setMessage(buyerPageMessage, "This vehicle has been marked as sold. You cannot start an enquiry.", true);
      return;
    }
    if (!car.addedBy) {
      setMessage(buyerPageMessage, "This listing is missing seller details. Please choose another vehicle.", true);
      return;
    }
    const id = currentUser.uid + "_" + carId;
    const conversationRef = doc(db, "conversations", id);
    const existing = await getDoc(conversationRef);
    if (!existing.exists()) {
      await setDoc(conversationRef, {
        buyerId: currentUser.uid,
        buyerName: currentProfile.name || currentUser.email || "Buyer",
        sellerId: car.addedBy,
        sellerName: car.sellerName || "Kiri Cars dealer",
        carId,
        carTitle: [(car.year || ""), (car.manufacturer || ""), (car.model || "")].filter(Boolean).join(" "),
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessage: "Enquiry started"
      });
    }
    selectedConversationId = id;
    await loadConversations();
    await openConversation(id);
    const url = new URL(window.location.href);
    url.searchParams.delete("car");
    url.searchParams.set("conversation", id);
    window.history.replaceState({}, "", url);
    setMessage(buyerPageMessage, "Your private enquiry is ready. Send a message to the dealer.");
  } catch (error) {
    console.error("Start conversation failed:", error);
    setMessage(buyerPageMessage, "Could not start this enquiry: " + (error.code || error.message) + ". Check that the Phase 3 Firestore rules have been published.", true);
  }
}

async function loadConversations() {
  if (!currentUser) return;
  conversationList.textContent = "Loading conversations...";
  try {
    const buyerQuery = query(collection(db, "conversations"), where("buyerId", "==", currentUser.uid));
    const sellerQuery = query(collection(db, "conversations"), where("sellerId", "==", currentUser.uid));
    const [buyerResults, sellerResults] = await Promise.all([getDocs(buyerQuery), getDocs(sellerQuery)]);
    const byId = new Map();
    [...buyerResults.docs, ...sellerResults.docs].forEach((item) => byId.set(item.id, { id: item.id, ...item.data() }));
    conversationCache = [...byId.values()].sort((a, b) => {
      const ta = a.lastMessageAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
      const tb = b.lastMessageAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });
    conversationList.replaceChildren();
    if (!conversationCache.length) {
      const empty = document.createElement("p");
      empty.className = "account-muted";
      empty.textContent = currentRole === "buyer"
        ? "No enquiries yet. Browse cars and choose “Message Dealer Privately” to start one."
        : "No buyer enquiries yet. New private messages about your vehicles will appear here.";
      conversationList.appendChild(empty);
      return;
    }
    conversationCache.forEach((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "conversation-item" + (conversation.id === selectedConversationId ? " active" : "");
      const title = document.createElement("strong");
      title.textContent = conversation.carTitle || "Vehicle enquiry";
      const otherParty = document.createElement("span");
      otherParty.textContent = currentUser.uid === conversation.buyerId
        ? "Dealer: " + (conversation.sellerName || "Dealer")
        : "Buyer: " + (conversation.buyerName || "Buyer");
      const preview = document.createElement("span");
      preview.textContent = conversation.lastMessage || "Enquiry started";
      const time = document.createElement("span");
      time.textContent = formatTime(conversation.lastMessageAt || conversation.createdAt);
      button.append(title, otherParty, preview, time);
      button.addEventListener("click", () => openConversation(conversation.id));
      conversationList.appendChild(button);
    });
  } catch (error) {
    console.error("Load conversations failed:", error);
    conversationList.textContent = "Could not load conversations: " + (error.code || error.message);
  }
}

async function openConversation(conversationId) {
  if (!currentUser) return;
  try {
    const conversationSnap = await getDoc(doc(db, "conversations", conversationId));
    if (!conversationSnap.exists()) {
      setMessage(buyerPageMessage, "That conversation could not be found.", true);
      return;
    }
    const conversation = conversationSnap.data();
    if (conversation.buyerId !== currentUser.uid && conversation.sellerId !== currentUser.uid) {
      setMessage(buyerPageMessage, "You do not have permission to view this conversation.", true);
      return;
    }
    selectedConversationId = conversationId;
    threadTitle.textContent = (conversation.carTitle || "Vehicle enquiry") + " — " +
      (currentUser.uid === conversation.buyerId ? (conversation.sellerName || "Dealer") : (conversation.buyerName || "Buyer"));
    messageForm.hidden = false;
    await loadMessages(conversationId);
    await loadConversations();
  } catch (error) {
    console.error("Open conversation failed:", error);
    setMessage(buyerPageMessage, "Could not open conversation: " + (error.code || error.message), true);
  }
}

async function loadMessages(conversationId) {
  messageStream.textContent = "Loading messages...";
  try {
    const messagesQuery = query(
      collection(db, "conversations", conversationId, "messages"),
      orderBy("createdAt", "asc")
    );
    const result = await getDocs(messagesQuery);
    messageStream.replaceChildren();
    if (result.empty) {
      const empty = document.createElement("p");
      empty.className = "account-muted";
      empty.textContent = "This is the start of your private conversation. Send the first message below.";
      messageStream.appendChild(empty);
      return;
    }
    result.docs.forEach((item) => {
      const message = item.data();
      const bubble = document.createElement("article");
      bubble.className = "message-bubble" + (message.senderId === currentUser.uid ? " mine" : "");
      const sender = document.createElement("strong");
      sender.textContent = (message.senderName || "Kiri Cars user") + " · " + formatTime(message.createdAt);
      const body = document.createElement("p");
      body.textContent = message.text || "";
      bubble.append(sender, body);
      messageStream.appendChild(bubble);
    });
    messageStream.scrollTop = messageStream.scrollHeight;
  } catch (error) {
    console.error("Load messages failed:", error);
    messageStream.textContent = "Could not load messages: " + (error.code || error.message);
  }
}

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser || !selectedConversationId) return;
  const text = messageText.value.trim();
  if (!text) return;
  if (text.length > 2000) {
    setMessage(buyerPageMessage, "Messages must be 2,000 characters or fewer.", true);
    return;
  }
  sendMessageButton.disabled = true;
  try {
    const conversationRef = doc(db, "conversations", selectedConversationId);
    const conversationSnap = await getDoc(conversationRef);
    if (!conversationSnap.exists()) throw new Error("Conversation no longer exists.");
    const conversation = conversationSnap.data();
    if (conversation.buyerId !== currentUser.uid && conversation.sellerId !== currentUser.uid) {
      throw new Error("You are not a participant in this conversation.");
    }
    await addDoc(collection(db, "conversations", selectedConversationId, "messages"), {
      senderId: currentUser.uid,
      senderName: currentProfile.name || currentUser.email || "Kiri Cars user",
      text,
      createdAt: serverTimestamp()
    });
    await updateDoc(conversationRef, {
      lastMessage: text.slice(0, 160),
      lastMessageAt: serverTimestamp()
    });
    messageText.value = "";
    await loadMessages(selectedConversationId);
    await loadConversations();
    setMessage(buyerPageMessage, "Message sent.");
  } catch (error) {
    console.error("Send message failed:", error);
    setMessage(buyerPageMessage, "Could not send message: " + (error.code || error.message), true);
  } finally {
    sendMessageButton.disabled = false;
  }
});

refreshInbox.addEventListener("click", async () => {
  await loadConversations();
  if (selectedConversationId) await loadMessages(selectedConversationId);
});

buyerSignOut.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

setAuthMode("signup");
