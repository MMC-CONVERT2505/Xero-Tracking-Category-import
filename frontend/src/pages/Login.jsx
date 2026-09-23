import React, { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import * as authApi from '../services/authApi.js';
import { Brand } from '../components/Sidebar.jsx';

const ERROR_MESSAGES = {
  invalid_state: 'Your sign-in session expired before Xero redirected back. Please try connecting again.',
  access_denied: 'Xero sign-in was cancelled.',
};

export default function Login() {
  const { loading, authenticated, selectedTenantId } = useAuth();
  const [params] = useSearchParams();
  const error = params.get('error');

  if (!loading && authenticated) {
    return <Navigate to={selectedTenantId ? '/dashboard' : '/select-organisation'} replace />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-canvas relative overflow-hidden">
      <BackgroundOrnament />

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center animate-fade-rise">
          <div className="flex justify-center mb-8">
            <Brand />
          </div>

          <h1 className="text-2xl font-semibold text-ink-900 tracking-tight">
            Import your Xero tracking data
          </h1>
          <p className="mt-3 text-ink-500 leading-relaxed">
            Connect your Xero organisation and bring thousands of tracking options in safely,
            without duplicates or manual data entry.
          </p>

          {error && (
            <p className="mt-5 text-sm text-danger-700 bg-danger-50 border border-danger-600/10 rounded-lg px-4 py-2.5">
              {ERROR_MESSAGES[error] || 'Something went wrong connecting to Xero. Please try again.'}
            </p>
          )}

          <button
            onClick={authApi.startXeroLogin}
            className="mt-8 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-700 text-white font-medium px-5 py-3 hover:bg-brand-800 transition-colors"
          >
            Connect Xero
          </button>

          <p className="mt-4 text-xs text-ink-400">Secure OAuth 2.0 connection - your Xero password is never shared with this app.</p>
        </div>
      </div>
    </div>
  );
}

// One deliberate, non-looping entrance moment - two soft washes that ease
// into place on load, nothing scattered or repeating.
function BackgroundOrnament() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute -top-32 -right-24 h-96 w-96 rounded-full bg-brand-100/60 blur-3xl animate-fade-in" />
      <div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-brand-50 blur-3xl animate-fade-in" style={{ animationDelay: '120ms' }} />
    </div>
  );
}
