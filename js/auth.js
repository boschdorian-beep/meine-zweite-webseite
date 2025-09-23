// js/auth.js
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { auth, db } from './firebase-init.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { state } from './state.js';

// UI Elements
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
            // Sicherstellen, dass das Profil in Firestore existiert (für spätere Kollaboration)
            await ensureUserProfile(user);
            // Rufe den Callback auf, um die App zu laden (main.js)
            onLoginSuccess();
        } else {
            // Benutzer ist abgemeldet
            state.user = null;
            // Zeige Login-Bildschirm
            showLoginScreen();
        }
    });
}

// Stellt sicher, dass ein Eintrag in der 'users' Collection existiert
async function ensureUserProfile(user) {
    const userRef = doc(db, "users", user.uid);
    try {
        const docSnap = await getDoc(userRef);
        if (!docSnap.exists()) {
            console.log("Erstelle Benutzerprofil in Firestore...");
            await setDoc(userRef, {
                uid: user.uid,
                email: user.email,
                createdAt: new Date()
            });
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
    elements.loadingSpinner.classList.add('hidden');
    elements.authContainer.classList.add('hidden');
    elements.appContainer.classList.remove('hidden');
    // Wechsle das Body-Layout für die App-Ansicht
    elements.body.classList.add('app-layout');
}

function displayError(message) {
    elements.authError.textContent = message;
}

// Event Handlers
function setupAuthUIEvents() {
    // Login
    document.getElementById('login-btn').addEventListener('click', async () => {
        displayError('');
        try {
            await signInWithEmailAndPassword(auth, elements.loginEmail.value, elements.loginPassword.value);
        } catch (error) {
            displayError(`Login fehlgeschlagen: ${error.message}`);
        }
    });

    // Register
    document.getElementById('register-btn').addEventListener('click', async () => {
        displayError('');
        try {
            await createUserWithEmailAndPassword(auth, elements.registerEmail.value, elements.registerPassword.value);
        } catch (error) {
            displayError(`Registrierung fehlgeschlagen: ${error.message}`);
        }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        signOut(auth);
    });

    // View toggles
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
