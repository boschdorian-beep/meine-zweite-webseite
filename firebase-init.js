// js/firebase-init.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

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

// Initialize Services
export const db = getFirestore(app);
export const auth = getAuth(app);

