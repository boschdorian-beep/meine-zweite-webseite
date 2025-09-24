// js/auth.js
// GEÄNDERT: Importiere sendEmailVerification
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { auth } from './firebase-init.js';
// db, doc, setDoc, getDoc werden nicht mehr direkt hier benötigt, sondern in collaboration.js
import { state } from './state.js';
import { detachListeners } from './database.js';
// NEU: Importiere Funktionen für das Benutzerprofil
import { initializeUserProfile, promptForMissingProfileData } from './collaboration.js';

// UI Elements
const elements = {
    loadingSpinner: document.getElementById('loading-spinner'),
    authContainer: document.getElementById('auth-container'),
    appContainer: document.getElementById('app-container'),
    loginView: document.getElementById('login-view'),
    registerView: document.getElementById('register-view'),
    authError: document.getElementById('auth-error'),
    // Login/Register inputs werden jetzt in den Handlern direkt gelesen
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
            
            if (!user.emailVerified) {
                console.log("E-Mail noch nicht verifiziert.");
                // Hinweis: Aktuell wird der Zugang erlaubt, aber man könnte ihn hier auch blockieren.
            }

            // GEÄNDERT: Sicherstellen, dass das Profil existiert und vollständig ist
            const profile = await initializeUserProfile(user);
            
            // NEU: Prüfe, ob Daten fehlen (Migration für bestehende Nutzer)
            if (!profile || !profile.displayName || !profile.shortName) {
                // Dies blockiert die Ausführung, bis der Nutzer die Daten eingegeben hat.
                await promptForMissingProfileData(user);
            }

            // Rufe den Callback auf (main.js startet dann die Daten-Listener)
            // Nur wenn das Profil nun vollständig ist.
            if (state.userProfile && state.userProfile.shortName) {
                onLoginSuccess();
            } else {
                console.error("Profil konnte nicht vervollständigt werden. Logout.");
                signOut(auth);
            }

        } else {
            // Benutzer ist abgemeldet
            console.log("User logged out.");
            handleLogoutCleanup();
            // Zeige Login-Bildschirm
            showLoginScreen();
        }
    });
}

/**
 * Führt Cleanup-Aufgaben beim Logout durch.
 */
function handleLogoutCleanup() {
    // 1. Beende Firestore Listener
    detachListeners();
    
    // 2. Lösche lokalen State (verhindert Datenlecks zwischen Usern)
    state.user = null;
    state.userProfile = null; // NEU
    state.tasks = [];
    state.schedule = [];
    state.settings = {};
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
    // NEU: Sicherstellen, dass das Profil vollständig geladen ist, bevor die App angezeigt wird
    if (!state.userProfile || !state.userProfile.shortName) {
        console.log("Warte auf vollständiges Profil...");
        return;
    }

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
function setupAuthUIEvents() {
    // Login
    document.getElementById('login-btn').addEventListener('click', async () => {
        displayError('');
        const email = document.getElementById('login-email').value.toLowerCase().trim();
        const password = document.getElementById('login-password').value;
        
        showLoadingScreen();
        try {
            await signInWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged kümmert sich um den Rest
        } catch (error) {
            showLoginScreen();
            displayError(`Login fehlgeschlagen: ${error.message}`);
        }
    });

    // Register (Stark überarbeitet)
    document.getElementById('register-btn').addEventListener('click', async () => {
        displayError('');

        const email = document.getElementById('register-email').value.toLowerCase().trim();
        const password = document.getElementById('register-password').value;
        const displayName = document.getElementById('register-displayname').value.trim();
        // Kürzel wird normalisiert (Großbuchstaben, max 5 Zeichen wie im HTML definiert)
        const shortName = document.getElementById('register-shortname').value.trim().toUpperCase();

        if (!displayName || !shortName) {
            displayError("Bitte gib deinen Namen und ein Kürzel ein.");
            return;
        }

        showLoadingScreen();
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // NEU: Sende E-Mail Verifizierung
            try {
                await sendEmailVerification(user);
                alert("Registrierung erfolgreich! Bitte überprüfe dein E-Mail-Postfach (auch Spam-Ordner), um deine Adresse zu bestätigen.");
            } catch (error) {
                console.error("Fehler beim Senden der Verifizierungs-E-Mail:", error);
                // Wir blockieren die Registrierung nicht, falls das Senden fehlschlägt.
            }

            // NEU: Erstelle das Benutzerprofil in Firestore mit den zusätzlichen Daten
            await initializeUserProfile(user, { displayName, shortName });

            // onAuthStateChanged kümmert sich um den Rest

        } catch (error) {
            showLoginScreen();
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
