// ============================================================
// auth.js
// Reusable authentication functions used across all pages.
//
// Functions exported:
//   loginUser(email, password)      — signs in + redirects by role
//   logoutUser()                    — signs out + redirects to index
//   checkAuthAndRedirect(role)      — auth guard for dashboard pages
// ============================================================

import { auth, db } from "./firebase-config.js";

import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";


// ------------------------------------------------------------
// loginUser
// Signs the user in with email + password.
// Checks email verification FIRST before allowing dashboard access.
// Throws a specific error code "auth/email-not-verified" if not verified.
// ------------------------------------------------------------
export async function loginUser(email, password) {
    // Step 1: Firebase Auth sign-in
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Step 2: Check if the user has verified their email
    if (!user.emailVerified) {
        // Sign them out immediately — don't let them into the app
        await signOut(auth);

        // Throw a custom error that index.html can catch and display clearly
        const err = new Error("Please verify your email before logging in. Check your inbox and spam/promotions folder.");
        err.code = "auth/email-not-verified";
        throw err;
    }

    // Step 3: Fetch user profile from Firestore to get their role
    const userDocRef = doc(db, "users", user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) {
        throw new Error("User profile not found. Please register again.");
    }

    const userData = userDocSnap.data();
    const role = userData.role;

    // Step 4: Redirect based on role
    if (role === "ngo") {
        window.location.href = "ngo-dashboard.html";
    } else if (role === "volunteer") {
        window.location.href = "volunteer-dashboard.html";
    } else {
        throw new Error("Unknown role assigned. Please contact admin.");
    }
}


// ------------------------------------------------------------
// logoutUser
// Signs the user out and sends them back to the login page.
// ------------------------------------------------------------
export async function logoutUser() {
    await signOut(auth);
    window.location.href = "index.html";
}


// ------------------------------------------------------------
// checkAuthAndRedirect
// Auth guard — call this at the top of every dashboard page.
// Also enforces email verification — unverified users get booted.
//
// Usage:
//   const { user, userData } = await checkAuthAndRedirect("ngo");
//
// Pass null for expectedRole to allow any authenticated+verified user.
// ------------------------------------------------------------
export function checkAuthAndRedirect(expectedRole) {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            unsubscribe();

            if (!user) {
                window.location.href = "index.html";
                reject(new Error("Not authenticated"));
                return;
            }

            // Extra guard: if an unverified user somehow reaches a dashboard, boot them
            if (!user.emailVerified) {
                await signOut(auth);
                window.location.href = "index.html";
                reject(new Error("Email not verified"));
                return;
            }

            try {
                const userDocRef = doc(db, "users", user.uid);
                const userDocSnap = await getDoc(userDocRef);

                if (!userDocSnap.exists()) {
                    window.location.href = "index.html";
                    reject(new Error("Profile not found"));
                    return;
                }

                const userData = userDocSnap.data();

                if (expectedRole && userData.role !== expectedRole) {
                    window.location.href = "index.html";
                    reject(new Error("Unauthorized: wrong role"));
                    return;
                }

                resolve({ user, userData });

            } catch (err) {
                window.location.href = "index.html";
                reject(err);
            }
        });
    });
}