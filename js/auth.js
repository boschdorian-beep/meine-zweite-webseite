// js/auth.js
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { auth, db } from './firebase-init.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { state } from './state.js';
// NEU: Importiere detachListeners
import { detachListeners } from './database.js';

// UI Elements (Unverändert)
const elements = {
    loadingSpinner: document.getElementById('loading-spinner'),
    authContainer: document.getElementById('auth-container'),
    appContainer: document.getElementById('app-container'),
    loginView: document.getElementById('login-view'),
    registerView: document.getElementById('register-view'),
    authError: document.getElementById('auth-error'),
    loginEmail: document.getElementById('login-email'),
    loginPassword: document.getElementById('login-password'),
    registerEmail: document.getElementById('register-email'),
    registerPassword: document.getElementById('register-password'),
    body: document.body,
};

// Initialisiert den Auth Listener und die UI Events
export function initializeAuth(onLoginSuccess) {
    setupAuthUIEvents();

    // Der Listener reagiert auf Login, Logout und Session-Wiederherstellung
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Benutzer ist angemeldet
            state.user = user;
            // Sicherstellen, dass das Profil existiert (für Kollaboration)
            await ensureUserProfile(user);
            // Rufe den Callback auf (main.js startet dann die Daten-Listener)
            onLoginSuccess();
        } else {
            // Benutzer ist abgemeldet
            console.log("User logged out.");
            // NEU: Cleanup durchführen
            handleLogoutCleanup();
            // Zeige Login-Bildschirm
            showLoginScreen();
        }
    });
}

/**
 * NEU: Führt Cleanup-Aufgaben beim Logout durch.
 */
function handleLogoutCleanup() {
    // 1. Beende Firestore Listener
    detachListeners();
    
    // 2. Lösche lokalen State (verhindert Datenlecks zwischen Usern)
    state.user = null;
    state.tasks = [];
    state.schedule = [];
    state.settings = {};
}


// Stellt sicher, dass ein Eintrag in der 'users' Collection existiert
// GEÄNDERT: Normalisiert E-Mail zu Lowercase und aktualisiert bestehende Profile
async function ensureUserProfile(user) {
    const userRef = doc(db, "users", user.uid);
    const normalizedEmail = user.email.toLowerCase().trim();
    try {
        const docSnap = await getDoc(userRef);
        // Prüfe ob Profil existiert ODER ob die E-Mail nicht lowercase ist (Update alter Profile)
        if (!docSnap.exists() || (docSnap.exists() && docSnap.data().email !== normalizedEmail)) {
            console.log("Erstelle oder aktualisiere Benutzerprofil in Firestore...");
            await setDoc(userRef, {
                uid: user.uid,
                email: normalizedEmail, 
                updatedAt: new Date()
            }, { merge: true }); // merge: true ist wichtig für Updates
        }
    } catch (error) {
        console.error("Fehler beim Sicherstellen des Benutzerprofils:", error);
    }
}


// UI Management Funktionen
export function showLoadingScreen() {
    elements.loadingSpinner.classList.remove('hidden');
    elements.authContainer.classList.add('hidden');
    elements.appContainer.classList.add('hidden');
    elements.body.classList.remove('app-layout');
}

function showLoginScreen() {
    elements.loadingSpinner.classList.add('hidden');
    elements.appContainer.classList.add('hidden');
    elements.authContainer.classList.remove('hidden');
    elements.body.classList.remove('app-layout');
}

export function showAppScreen() {
    // Nur anzeigen wenn nicht bereits sichtbar, um Flackern zu vermeiden
    if (elements.appContainer.classList.contains('hidden')) {
        elements.loadingSpinner.classList.add('hidden');
        elements.authContainer.classList.add('hidden');
        elements.appContainer.classList.remove('hidden');
        elements.body.classList.add('app-layout');
    }
}

function displayError(message) {
    elements.authError.textContent = message;
}

// Event Handlers
// GEÄNDERT: Normalisiert E-Mails bei Login/Register
function setupAuthUIEvents() {
    // Login
    document.getElementById('login-btn').addEventListener('click', async () => {
        displayError('');
        try {
            // E-Mail wird normalisiert
            const email = elements.loginEmail.value.toLowerCase().trim();
            await signInWithEmailAndPassword(auth, email, elements.loginPassword.value);
        } catch (error) {
            displayError(`Login fehlgeschlagen: ${error.message}`);
        }
    });

    // Register
    document.getElementById('register-btn').addEventListener('click', async () => {
        displayError('');
        try {
            // E-Mail wird normalisiert
            const email = elements.registerEmail.value.toLowerCase().trim();
            await createUserWithEmailAndPassword(auth, email, elements.registerPassword.value);
        } catch (error) {
            displayError(`Registrierung fehlgeschlagen: ${error.message}`);
        }
    });

    // Logout (Der onAuthStateChanged Listener kümmert sich um das Cleanup)
    document.getElementById('logout-btn').addEventListener('click', () => {
        signOut(auth);
    });

    // View toggles (Unverändert)
    document.getElementById('show-register').addEventListener('click', (e) => {
        e.preventDefault();
        elements.loginView.classList.add('hidden');
        elements.registerView.classList.remove('hidden');
        displayError('');
    });
    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        elements.registerView.classList.add('hidden');
        elements.loginView.classList.remove('hidden');
        displayError('');
    });
}
