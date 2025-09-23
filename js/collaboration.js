// js/collaboration.js
import { collection, query, where, getDocs, limit, doc } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase-init.js';
import { state } from './state.js';

/**
 * Sucht nach Benutzern basierend auf einer E-Mail-Präfix.
 * Firestore unterstützt keine "contains"-Suche, daher nutzen wir Prefix-Matching (für Auto-Complete).
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
            // Sich selbst nicht anzeigen
            if (data.uid !== state.user.uid) {
                results.push({ uid: data.uid, email: data.email });
            }
        });
        return results;
    } catch (error) {
        console.error("Fehler bei der Benutzersuche:", error);
        // Wenn der Index fehlt (siehe Anleitung oben), wird dieser Fehler geworfen.
        if (error.code === 'failed-precondition') {
            alert("Die Datenbank wird noch eingerichtet (Index für Benutzersuche fehlt). Bitte warten Sie einige Minuten oder prüfen Sie die Firebase-Konfiguration.");
        }
        return [];
    }
}

/**
 * Holt Benutzerprofile für eine Liste von UIDs.
 * (Wird benötigt, um E-Mails für zugewiesene Benutzer anzuzeigen).
 */
export async function getUsersByIds(uids) {
    if (!uids || uids.length === 0) return {};

    // Entferne Duplikate
    const uniqueUids = [...new Set(uids)];
    if (uniqueUids.length === 0) return {};

    const usersRef = collection(db, "users");

    // Firestore 'in' query (max 30 items at a time)
    // Hinweis: Für sehr große Teams müsste man dies in Chunks aufteilen.
    const q = query(usersRef, where("uid", "in", uniqueUids.slice(0, 30)));

    try {
        const snapshot = await getDocs(q);
        const userMap = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            userMap[data.uid] = { uid: data.uid, email: data.email };
        });
        return userMap;
    } catch (error) {
        console.error("Fehler beim Abrufen der Benutzerprofile:", error);
        return {};
    }
}