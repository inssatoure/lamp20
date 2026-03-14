
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { APP_NAME } from '../constants';

export const LoginPage: React.FC = () => {
  const { register, login } = useAuth();

  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!phone.trim()) {
      setError('Entrez votre numéro de téléphone.');
      return;
    }
    if (!pin || pin.length < 4) {
      setError('Le PIN doit avoir au moins 4 chiffres.');
      return;
    }
    if (isSignUp && !name.trim()) {
      setError('Entrez votre nom complet.');
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        await register(name, phone, pin);
      } else {
        await login(phone, pin);
      }
    } catch (err: any) {
      setError(err.message || 'Erreur de connexion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden p-4">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-10 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-teal-500 rounded-full blur-[100px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] bg-teal-700 rounded-full blur-[100px]" />
      </div>

      <div className="bg-white p-8 md:p-10 rounded-3xl shadow-2xl w-full max-w-md relative z-10 flex flex-col items-center border border-teal-50">
        <div className="w-16 h-16 bg-gradient-to-br from-teal-500 to-teal-700 rounded-2xl flex items-center justify-center mb-6 shadow-lg rotate-3 hover:rotate-6 transition-transform">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 mb-1">{APP_NAME}</h1>
        <p className="text-slate-500 mb-6 text-sm text-center">
          {isSignUp
            ? 'Créez votre compte pour accéder au savoir.'
            : 'Connectez-vous avec votre numéro et PIN.'}
        </p>

        {error && (
          <div className="w-full bg-red-50 text-red-600 text-xs p-3 rounded-lg mb-4 border border-red-100 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          {isSignUp && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 ml-1">Nom complet</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all text-sm"
                placeholder="Modou Fall"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 ml-1">Numéro de téléphone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all text-sm"
              placeholder="+221 77 123 45 67"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 ml-1">Code PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              maxLength={8}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all text-lg tracking-[0.5em] text-center"
              placeholder="****"
            />
            <p className="text-[10px] text-slate-400 ml-1">Minimum 4 chiffres</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-xl shadow-lg shadow-teal-200 transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>{isSignUp ? 'Créer mon compte' : 'Se connecter'}</span>
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-sm text-slate-600">
            {isSignUp ? 'Déjà inscrit ?' : "Pas encore de compte ?"}
          </p>
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
            className="text-sm font-bold text-teal-600 hover:text-teal-700 mt-1"
          >
            {isSignUp ? 'Se connecter' : "S'inscrire"}
          </button>
        </div>
      </div>
    </div>
  );
};
