
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  registerUser,
  loginUser,
  getUserById,
  saveSession,
  getStoredSession,
  clearSession,
  PhoneUser,
} from '../services/authService';

interface AuthContextType {
  user: PhoneUser | null;
  loading: boolean;
  isAdmin: boolean;
  register: (name: string, phone: string, pin: string) => Promise<void>;
  login: (phone: string, pin: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  register: async () => {},
  login: async () => {},
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<PhoneUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const storedId = getStoredSession();
      if (storedId) {
        try {
          const restored = await getUserById(storedId);
          if (restored) {
            setUser(restored);
          } else {
            clearSession();
          }
        } catch {
          clearSession();
        }
      }
      setLoading(false);
    };
    restoreSession();
  }, []);

  const register = async (name: string, phone: string, pin: string) => {
    const newUser = await registerUser(name, phone, pin);
    setUser(newUser);
    saveSession(newUser.id);
  };

  const login = async (phone: string, pin: string) => {
    const loggedIn = await loginUser(phone, pin);
    setUser(loggedIn);
    saveSession(loggedIn.id);
  };

  const logout = () => {
    setUser(null);
    clearSession();
  };

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
