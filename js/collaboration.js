// js/collaboration.js
import { db } from './firebase-init.js';
// Wir benötigen documentId für die effiziente Abfrage nach IDs
import { collection, query, where, getDocs, doc, getDoc, setDoc, documentId, limit } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { state } from './state.js';

// NEU: Cache für geladene Benutzerprofile (verhindert unnötige Firestore Reads)
const userCache = {};

/**
 * NEU: Stellt sicher, dass das Benutzerprofil in Firestore existiert, initialisiert ist und im State/Cache liegt.
 * Ersetzt ensureUserProfile aus auth.js.
 */
export async function initializeUserProfile(user, additionalData = {}) {
    if (!user) return null;

    const userRef = doc(db, "users", user.uid);
    const normalizedEmail = user.email.toLowerCase().trim();
    
    try {
        const docSnap = await getDoc(userRef);
        const existingData = docSnap.exists() ? docSnap.data() : {};

        // Definiere die Datenstruktur für das Profil
        const profileData = {
            uid: user.uid,
            email: normalizedEmail,
            // Verwende neue Daten (bei Registrierung), bestehende Daten (bei Login) oder Fallbacks
            displayName: additionalData.displayName || existingData.displayName || null,
            // Kürzel wird auf max 5 Zeichen begrenzt und in Großbuchstaben gespeichert
            shortName: (additionalData.shortName || existingData.shortName || null)?.toUpperCase().substring(0, 5),
        };

        // Speichern/Aktualisieren in Firestore, wenn:
        // 1. Dokument nicht existiert (Neuer Nutzer)
        // 2. Neue Daten übergeben wurden (Registrierung oder Profil-Update)
        // 3. Die E-Mail im bestehenden Dokument nicht normalisiert ist (Update alter Profile)
        if (!docSnap.exists() || Object.keys(additionalData).length > 0 || existingData.email !== normalizedEmail) {
            console.log("Aktualisiere oder erstelle User Profil in DB...");
            await setDoc(userRef, profileData, { merge: true });
        }

        // Füge das Profil zum Cache und State hinzu
        userCache[user.uid] = profileData;
        state.userProfile = profileData;
        return profileData;

    } catch (error) {
        console.error("Error initializing user profile:", error);
        return null;
    }
}

/**
 * NEU: Fordert bestehende Benutzer auf, fehlende Profildaten nachzutragen (via Browser-Prompt).
 * Migration für Nutzer, die sich vor dem Update registriert haben.
 */
export async function promptForMissingProfileData(user) {
    alert("Willkommen zurück! Wir haben neue Funktionen hinzugefügt. Bitte vervollständige kurz dein Profil.");
    
    // Erzwinge Eingabe mittels while-Schleife
    let displayName = null;
    while (!displayName) {
        displayName = prompt("Bitte gib deinen Namen ein (z.B. Max Mustermann):");
    }

    let shortName = null;
    while (!shortName) {
        shortName = prompt("Bitte gib ein Kürzel ein (z.B. MM), maximal 5 Zeichen:");
    }

    if (displayName && shortName) {
        // initializeUserProfile kümmert sich um die Speicherung und das Update des States.
        await initializeUserProfile(user, { displayName, shortName });
    } else {
        // Fallback (sollte durch while nicht passieren)
        alert("Profilaktualisierung fehlgeschlagen. Standardwerte werden verwendet.");
        await initializeUserProfile(user, { 
            displayName: user.email.split('@')[0], 
            shortName: user.email.substring(0, 2).toUpperCase() 
        });
    }
}

/**
 * Sucht nach Benutzern anhand ihrer E-Mail-Adresse (Präfix-Suche).
 */
export async function searchUsers(searchTerm) {
    if (!state.user || searchTerm.length < 2) return [];

    const normalizedTerm = searchTerm.toLowerCase().trim();
    const usersRef = collection(db, "users");

    // Firestore Prefix Query: Suche alles von searchTerm bis zum nächsten logischen Zeichen ('\uf8ff').
    const q = query(
        usersRef,
        where("email", ">=", normalizedTerm),
        where("email", "<", normalizedTerm + '\uf8ff'),
        limit(10)
    );

    try {
        const snapshot = await getDocs(q);
        const results = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Füge gefundene Benutzer zum Cache hinzu
            userCache[doc.id] = data;

            // Sich selbst nicht anzeigen
            if (data.uid !== state.user.uid) {
                // GEÄNDERT: Gebe das vollständige Profil zurück
                results.push(data);
            }
        });
        return results;
    } catch (error) {
        console.error("Fehler bei der Benutzersuche:", error);
        // Wenn der Index fehlt, wird dieser Fehler geworfen.
        if (error.code === 'failed-precondition' || error.code === 'permission-denied') {
            alert("Fehler bei der Benutzersuche. Bitte prüfen Sie die Firestore-Indizes und Sicherheitsregeln (siehe Konsole für Details).");
        }
        return [];
    }
}

/**
 * Holt Benutzerprofile für eine Liste von UIDs. Nutzt Caching und effiziente Abfragen.
 */
export async function getUsersByIds(uids) {
    const profiles = {};
    const uidsToFetch = [];

    // Eindeutige UIDs filtern und Cache prüfen
    [...new Set(uids)].forEach(uid => {
        if (userCache[uid]) {
            profiles[uid] = userCache[uid];
        } else if (uid) {
            uidsToFetch.push(uid);
        }
    });

    if (uidsToFetch.length === 0) {
        return profiles;
    }

    // Fetch missing profiles
    try {
        // Hole Dokumente in Batches von 30 (Firestore Limit für 'in' Query)
        const batches = [];
        for (let i = 0; i < uidsToFetch.length; i += 30) {
            batches.push(uidsToFetch.slice(i, i + 30));
        }

        for (const batch of batches) {
            // WICHTIG: Wir fragen direkt die Dokument-IDs ab (performanter als where("uid", "in", ...))
            const q = query(collection(db, "users"), where(documentId(), "in", batch));
            const querySnapshot = await getDocs(q);
            querySnapshot.forEach(doc => {
                const data = doc.data();
                userCache[doc.id] = data;
                profiles[doc.id] = data;
            });
        }

    } catch (error) {
        console.error("Error fetching users by IDs:", error);
    }

    return profiles;
}

/**
 * NEU: Holt die Kürzel für eine Liste von UIDs, exklusive des aktuellen Benutzers.
 * Wird für die Anzeige in der Aufgabenliste verwendet.
 */
export async function getShortNamesForUids(uids) {
    // Wenn nur ein (oder kein) Nutzer zugewiesen ist, gibt es nichts anzuzeigen.
    if (!uids || uids.length <= 1) return [];

    // Lade Profile (nutzt Cache)
    const profiles = await getUsersByIds(uids);
    const currentUserId = state.user ? state.user.uid : null;

    const shortNames = uids
        .filter(uid => uid !== currentUserId) // Eigenes Kürzel nicht anzeigen
        .map(uid => {
            const profile = profiles[uid];
            // Verwende Kürzel oder Fallback (ersten 2 Buchstaben der E-Mail), falls Profil nicht geladen werden konnte
            return profile && profile.shortName ? profile.shortName : (profile && profile.email ? profile.email.substring(0, 2).toUpperCase() : '??');
        });

    return shortNames;
}
