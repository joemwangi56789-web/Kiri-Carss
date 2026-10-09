
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

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
const db = getFirestore(app);

export { app, auth, db };
