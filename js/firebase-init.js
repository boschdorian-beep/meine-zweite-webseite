// js/firebase-init.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

// !!! WICHTIG !!!
// HIER DEINE EIGENE FIREBASE KONFIGURATION EINFÜGEN
// Gehe zu Firebase Console -> Projekteinstellungen -> Allgemein -> Deine Apps
const firebaseConfig = {
    apiKey: "DEIN_API_KEY",
    authDomain: "DEIN_AUTH_DOMAIN",
    projectId: "DEIN_PROJECT_ID",
    storageBucket: "DEIN_STORAGE_BUCKET",
    messagingSenderId: "DEIN_MESSAGING_SENDER_ID",
    appId: "DEIN_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services
export const db = getFirestore(app);
export const auth = getAuth(app);
