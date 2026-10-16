
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCyNabsDhFxovmkbL7HwCXEmR8x14cpbRU",
  authDomain: "kiri-cars.firebaseapp.com",
  projectId: "kiri-cars",
  storageBucket: "kiri-cars.firebasestorage.app",
  messagingSenderId: "380481816413",
  appId: "1:380481816413:web:0764b7d2a229a7dc2b0ab4",
  measurementId: "G-773GQDCQB2"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

// Enable local persistence (survives browser restarts, tab closes)
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Failed to set auth persistence:", error);
});

const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };
