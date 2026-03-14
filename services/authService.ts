
import { db } from './firebase';
import { collection, addDoc, getDocs, query, where, doc, getDoc } from '@firebase/firestore';

export interface PhoneUser {
  id: string;
  name: string;
  phone: string;
  pinHash: string;
  role: 'admin' | 'user';
  createdAt: number;
}

const USERS_COLLECTION = 'users_phone';

// Admin phone number — auto-assigned admin role on registration
const ADMIN_PHONE = '+221771605060';

/**
 * Simple SHA-256 hash for PIN using Web Crypto API.
 * Salted with the phone number to prevent rainbow table attacks.
 */
async function hashPin(pin: string, phone: string): Promise<string> {
  const data = new TextEncoder().encode(phone + ':' + pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Register a new user with name + phone + PIN.
 * Returns the user object on success, throws on failure.
 */
export async function registerUser(name: string, phone: string, pin: string): Promise<PhoneUser> {
  // Normalize phone
  const normalizedPhone = normalizePhone(phone);

  // Check if phone already exists
  const existing = await findUserByPhone(normalizedPhone);
  if (existing) {
    throw new Error('Ce numéro est déjà enregistré. Connectez-vous.');
  }

  if (pin.length < 4) {
    throw new Error('Le PIN doit avoir au moins 4 chiffres.');
  }

  if (!name.trim()) {
    throw new Error('Le nom est requis.');
  }

  const pinHash = await hashPin(pin, normalizedPhone);

  const userData = {
    name: name.trim(),
    phone: normalizedPhone,
    pinHash,
    role: normalizedPhone === ADMIN_PHONE ? 'admin' as const : 'user' as const,
    createdAt: Date.now(),
  };

  const docRef = await addDoc(collection(db, USERS_COLLECTION), userData);

  return { id: docRef.id, ...userData };
}

/**
 * Login with phone + PIN.
 * Returns the user object on success, throws on failure.
 */
export async function loginUser(phone: string, pin: string): Promise<PhoneUser> {
  const normalizedPhone = normalizePhone(phone);

  let user = await findUserByPhone(normalizedPhone);
  let oldPhone: string | null = null;

  // Fallback: if 9-digit Senegalese number, also try the old incorrect format (+7xxx)
  if (!user && /^\+221\d{9}$/.test(normalizedPhone)) {
    oldPhone = '+' + normalizedPhone.slice(4); // +771605060
    user = await findUserByPhone(oldPhone);
  }

  if (!user) {
    throw new Error('Numéro non trouvé. Veuillez vous inscrire.');
  }

  // Verify PIN — try hash with normalized phone, then with old phone format
  const pinHash = await hashPin(pin, normalizedPhone);
  let pinOk = pinHash === user.pinHash;

  if (!pinOk && oldPhone) {
    const pinHashOld = await hashPin(pin, oldPhone);
    pinOk = pinHashOld === user.pinHash;
  }

  if (!pinOk) {
    throw new Error('PIN incorrect.');
  }

  // After successful login, fix phone format + role if needed
  const needsUpdate = user.phone !== normalizedPhone || (normalizedPhone === ADMIN_PHONE && user.role !== 'admin');
  if (needsUpdate) {
    const { doc: firestoreDoc, updateDoc } = await import('@firebase/firestore');
    const isAdminPhone = normalizedPhone === ADMIN_PHONE;
    // Rehash PIN with correct phone for future logins
    const newPinHash = await hashPin(pin, normalizedPhone);
    await updateDoc(firestoreDoc(db, USERS_COLLECTION, user.id), {
      phone: normalizedPhone,
      pinHash: newPinHash,
      ...(isAdminPhone ? { role: 'admin' } : {})
    });
    user.phone = normalizedPhone;
    user.pinHash = newPinHash;
    if (isAdminPhone) user.role = 'admin';
  }

  return user;
}

/**
 * Find a user by phone number.
 */
async function findUserByPhone(phone: string): Promise<PhoneUser | null> {
  const q = query(
    collection(db, USERS_COLLECTION),
    where('phone', '==', phone)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;

  const docSnap = snapshot.docs[0];
  return { id: docSnap.id, ...docSnap.data() } as PhoneUser;
}

/**
 * Get user by ID (for session restoration).
 */
export async function getUserById(userId: string): Promise<PhoneUser | null> {
  try {
    const docSnap = await getDoc(doc(db, USERS_COLLECTION, userId));
    if (!docSnap.exists()) return null;
    return { id: docSnap.id, ...docSnap.data() } as PhoneUser;
  } catch {
    return null;
  }
}

/**
 * Get all users (admin only).
 */
export async function getAllUsers(): Promise<PhoneUser[]> {
  const snapshot = await getDocs(collection(db, USERS_COLLECTION));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PhoneUser));
}

/**
 * Normalize phone number: remove spaces, ensure starts with country code.
 */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  // If starts with 0, assume Senegal (+221)
  if (cleaned.startsWith('0')) {
    cleaned = '+221' + cleaned.slice(1);
  }
  // If 9 digits starting with 7 (Senegalese mobile), add +221
  if (/^7\d{8}$/.test(cleaned)) {
    cleaned = '+221' + cleaned;
  }
  // If starts with 221 without +, add +
  if (cleaned.startsWith('221') && cleaned.length === 12) {
    cleaned = '+' + cleaned;
  }
  // If doesn't start with +, add +
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

// Session persistence — store user ID in localStorage for session continuity
const SESSION_KEY = 'lamp_session_uid';

export function saveSession(userId: string): void {
  localStorage.setItem(SESSION_KEY, userId);
}

export function getStoredSession(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
