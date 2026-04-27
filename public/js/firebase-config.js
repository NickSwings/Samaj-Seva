import { initializeApp }  from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey:            "AIzaSyACaPT7Zc89aoUfxEGTsmQdyUax5tcMM0M",
    authDomain:        "samaj-seva-visca-barca.firebaseapp.com",
    projectId:         "samaj-seva-visca-barca",
    storageBucket:     "samaj-seva-visca-barca.firebasestorage.app",
    messagingSenderId: "1061844985075",
    appId:             "1:1061844985075:web:246c2cfe6f5991082f4386",
    measurementId:     "G-CF8B7LKP2Q"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
