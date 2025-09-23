// js/firebase-init.js
// Importiere die notwendigen Funktionen vom Firebase SDK CDN (Verwende eine feste Version für Stabilität)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

// Deine Web-App Firebase Konfiguration
const firebaseConfig = {
    apiKey: "AIzaSyBDZk2LZZwyYG0hgWEOUMRhqzq4jDufQ3U",
    authDomain: "zeitplan-d9e32.firebaseapp.com",
    projectId: "zeitplan-d9e32",
    storageBucket: "zeitplan-d9e32.firebasestorage.app",
    messagingSenderId: "721044684709",
    // appId: "Füge hier deine AppID ein, falls du sie in der Konsole findest (optional)",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services und exportiere sie
export const auth = getAuth(app);
export const db = getFirestore(app);