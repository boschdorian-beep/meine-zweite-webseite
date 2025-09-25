// js/auth.js
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { auth } from './firebase-init.js';
import { state } from './state.js';
import { detachListeners } from './database.js';
import { initializeUserProfile, promptForMissingProfileData } from './collaboration.js';

// UI Elements
const elements = {
    loadingSpinner: document.getElementById('loading-spinner'),
    authContainer: document.getElementById('auth-container'),
    appContainer: document.getElementById('app-container'),
    loginView: document.getElementById('login-view'),
    registerView: document.getElementById('register-view'),
    // NEU: View für E-Mail Verifizierung
    verificationView: document.getElementById('verification-view'),
    authError: document.getElementById('auth-error'),
    body: document.body,
};

// Initialisiert den Auth Listener und die UI Events
export function initializeAuth(onLoginSuccess) {
    setupAuthUIEvents();

    // Der Listener reagiert auf Login, Logout und Session-Wiederherstellung
    onAuthStateChanged(auth, async (user) => {
        // Wir zeigen nicht sofort den Ladebildschirm, um Flackern zu vermeiden, 
        // stellen aber sicher, dass der richtige Bildschirm angezeigt wird.

        if (user) {
            // Benutzer ist angemeldet

            // GEÄNDERT: 2. Prüfe E-Mail Verifizierung
            if (!user.emailVerified) {
                console.log("E-Mail noch nicht verifiziert. Blockiere Zugang.");
                // Zeige den Verifizierungsbildschirm an
                showVerificationScreen(user.email);
                // WICHTIG: Hier abbrechen. Wir betrachten den Nutzer nicht als vollständig eingeloggt.
                return;
            }

            // 3. Sicherstellen, dass das Profil existiert und vollständig ist
            state.user = user;
            const profile = await initializeUserProfile(user);
            
            if (!profile || !profile.displayName || !profile.shortName) {
                // Dies blockiert die Ausführung, bis der Nutzer die Daten eingegeben hat.
                await promptForMissingProfileData(user);
            }

            // 4. Rufe den Callback auf (main.js startet dann die Daten-Listener)
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
    state.userProfile = null;
    state.tasks = [];
    state.schedule = [];
    state.settings = {};
    // NEU: State für neue Aufgaben zurücksetzen
    state.newTaskAssignment = [];
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
    // Sicherstellen, dass der Login-View aktiv ist
    elements.loginView.classList.remove('hidden');
    elements.registerView.classList.add('hidden');
    if (elements.verificationView) elements.verificationView.classList.add('hidden');
    elements.body.classList.remove('app-layout');
}

// NEU: Zeigt den Bildschirm an, wenn die E-Mail noch nicht verifiziert ist
function showVerificationScreen(email) {
    if (!elements.verificationView) {
        // Fallback, falls das HTML Element fehlt (sollte nicht passieren)
        alert("Bitte bestätige deine E-Mail Adresse.");
        signOut(auth);
        return;
    }
    document.getElementById('verification-email-display').textContent = email || 'deinem Postfach';
    elements.loadingSpinner.classList.add('hidden');
    elements.appContainer.classList.add('hidden');
    elements.authContainer.classList.remove('hidden');
    
    elements.loginView.classList.add('hidden');
    elements.registerView.classList.add('hidden');
    elements.verificationView.classList.remove('hidden');
    elements.body.classList.remove('app-layout');
}

export function showAppScreen() {
    // Sicherstellen, dass das Profil vollständig geladen ist, bevor die App angezeigt wird
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
            // onAuthStateChanged kümmert sich um den Rest (inkl. Prüfung der Verifizierung)
        } catch (error) {
            showLoginScreen();
            displayError(`Login fehlgeschlagen: ${error.message}`);
        }
    });

    // Register
    document.getElementById('register-btn').addEventListener('click', async () => {
        displayError('');

        const email = document.getElementById('register-email').value.toLowerCase().trim();
        const password = document.getElementById('register-password').value;
        const displayName = document.getElementById('register-displayname').value.trim();
        const shortName = document.getElementById('register-shortname').value.trim().toUpperCase();

        if (!displayName || !shortName) {
            displayError("Bitte gib deinen Namen und ein Kürzel ein.");
            return;
        }

        showLoadingScreen();
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // Sende E-Mail Verifizierung
            try {
                await sendEmailVerification(user);
                // Der Benutzer wird automatisch angemeldet, aber onAuthStateChanged leitet ihn zum Verifizierungsbildschirm weiter.
            } catch (error) {
                console.error("Fehler beim Senden der Verifizierungs-E-Mail:", error);
            }

            // Erstelle das Benutzerprofil in Firestore
            await initializeUserProfile(user, { displayName, shortName });

            // onAuthStateChanged kümmert sich um den Rest

        } catch (error) {
            showLoginScreen();
            displayError(`Registrierung fehlgeschlagen: ${error.message}`);
        }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        signOut(auth);
    });

    // NEU: Event Listener für den Verifizierungsbildschirm
    if (elements.verificationView) {
        document.getElementById('logout-verification-btn').addEventListener('click', () => {
            signOut(auth);
        });

        document.getElementById('resend-verification-btn').addEventListener('click', async () => {
            const user = auth.currentUser;
            if (user && !user.emailVerified) {
                try {
                    await sendEmailVerification(user);
                    alert("Verifizierungs-E-Mail erneut gesendet! Bitte überprüfe dein Postfach (auch Spam-Ordner).");
                } catch (error) {
                    alert("Fehler beim erneuten Senden der E-Mail: " + error.message);
                }
            }
        });

        document.getElementById('check-verification-btn').addEventListener('click', () => {
            // Der einfachste Weg, den Auth-Status neu zu prüfen, ist das Neuladen der Seite.
            // Firebase aktualisiert den Token beim Neuladen.
            window.location.reload();
        });
    }

    // View toggles
    document.getElementById('show-register').addEventListener('click', (e) => {
        e.preventDefault();
        elements.loginView.classList.add('hidden');
        elements.registerView.classList.remove('hidden');
        if (elements.verificationView) elements.verificationView.classList.add('hidden');
        displayError('');
    });
    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        elements.registerView.classList.add('hidden');
        elements.loginView.classList.remove('hidden');
        if (elements.verificationView) elements.verificationView.classList.add('hidden');
        displayError('');
    });
}
