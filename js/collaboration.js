// js/collaboration.js
import { db } from './firebase-init.js';
import { collection, query, where, getDocs, doc, getDoc, setDoc, documentId, limit } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { state } from './state.js';

// Cache für geladene Benutzerprofile
const userCache = {};

/**
 * Stellt sicher, dass das Benutzerprofil in Firestore existiert, initialisiert ist und im State/Cache liegt.
 */
export async function initializeUserProfile(user, additionalData = {}) {
    if (!user) return null;

    const userRef = doc(db, "users", user.uid);
    // Sicherstellen, dass user.email existiert
    const normalizedEmail = user.email ? user.email.toLowerCase().trim() : null;
    
    try {
        const docSnap = await getDoc(userRef);
        const existingData = docSnap.exists() ? docSnap.data() : {};

        // Definiere die Datenstruktur für das Profil
        const profileData = {
            uid: user.uid,
            email: normalizedEmail,
            displayName: additionalData.displayName || existingData.displayName || null,
            shortName: (additionalData.shortName || existingData.shortName || null)?.toUpperCase().substring(0, 5),
        };

        // Speichern/Aktualisieren in Firestore
        if (!docSnap.exists() || Object.keys(additionalData).length > 0 || (normalizedEmail && existingData.email !== normalizedEmail)) {
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
 * Fordert bestehende Benutzer auf, fehlende Profildaten nachzutragen.
 */
export async function promptForMissingProfileData(user) {
    alert("Willkommen zurück! Wir haben neue Funktionen hinzugefügt. Bitte vervollständige kurz dein Profil.");
    
    let displayName = null;
    while (!displayName) {
        displayName = prompt("Bitte gib deinen Namen ein (z.B. Max Mustermann):");
    }

    let shortName = null;
    while (!shortName) {
        shortName = prompt("Bitte gib ein Kürzel ein (z.B. MM), maximal 5 Zeichen:");
    }

    // Fallback, falls user.email nicht verfügbar ist
    const fallbackName = user.email ? user.email.split('@')[0] : 'User';
    const fallbackShortName = user.email ? user.email.substring(0, 2).toUpperCase() : 'US';

    if (displayName && shortName) {
        await initializeUserProfile(user, { displayName, shortName });
    } else {
        // Fallback (sollte durch while nicht passieren)
        await initializeUserProfile(user, { 
            displayName: fallbackName, 
            shortName: fallbackShortName
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
            userCache[doc.id] = data;

            if (data.uid !== state.user.uid) {
                results.push(data);
            }
        });
        return results;
    } catch (error) {
        console.error("Fehler bei der Benutzersuche:", error);
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
 * Holt die Kürzel für eine Liste von UIDs, exklusive des aktuellen Benutzers.
 */
export async function getShortNamesForUids(uids) {
    if (!uids || uids.length <= 1) return [];

    // Lade Profile (nutzt Cache)
    const profiles = await getUsersByIds(uids);
    const currentUserId = state.user ? state.user.uid : null;

    const shortNames = uids
        .filter(uid => uid !== currentUserId) // Eigenes Kürzel nicht anzeigen
        .map(uid => {
            const profile = profiles[uid];
            // Verwende Kürzel oder Fallback
            return profile && profile.shortName ? profile.shortName : (profile && profile.email ? profile.email.substring(0, 2).toUpperCase() : '??');
        });

    return shortNames;
}

/**
 * NEU: Lädt alle Benutzerprofile, die in den aktuellen Tasks vorkommen (Teammitglieder).
 * Wird verwendet, um die Filterleiste zu füllen.
 */
export async function getAllUserProfilesInTasks() {
    // 1. Sammle alle eindeutigen UIDs aus state.tasks (außer dem aktuellen Benutzer)
    const currentUserId = state.user ? state.user.uid : null;
    const allUids = new Set();
    
    // Betrachte nur aktive Tasks für die Filterleiste
    const activeTasks = state.tasks.filter(t => !t.completed);

    activeTasks.forEach(task => {
        if (task.assignedTo) {
            task.assignedTo.forEach(uid => {
                if (uid !== currentUserId) {
                    allUids.add(uid);
                }
            });
        }
    });

    if (allUids.size === 0) {
        return [];
    }

    // 2. Lade die Profile (nutzt Caching)
    const profilesMap = await getUsersByIds([...allUids]);

    // 3. Konvertiere in ein Array und sortiere alphabetisch
    // Filtert null Werte, falls ein Profil nicht geladen werden konnte
    const profilesArray = Object.values(profilesMap).filter(p => p);
    profilesArray.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));

    return profilesArray;
}
