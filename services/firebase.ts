
// Use standard modular imports for Firebase v9+
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
// Fix: Using @firebase/firestore to resolve "no exported member" errors which sometimes occur with the main package path in specific TS environments.
import { getFirestore } from '@firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0",
  authDomain: "lampridial-19466.firebaseapp.com",
  projectId: "lampridial-19466",
  storageBucket: "lampridial-19466.firebasestorage.app",
  messagingSenderId: "76433392810",
  appId: "1:76433392810:web:92cac9a34da732f779bcd3",
  measurementId: "G-YGRDBW9HHH"
};

// Initialize Firebase services using standard modular functions
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
