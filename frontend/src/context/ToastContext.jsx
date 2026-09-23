import React, { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);
let idSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((message, variant = 'info', duration = 4000) => {
    const id = ++idSeq;
    setToasts((t) => [...t, { id, message, variant }]);
    if (duration) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const toast = {
    show,
    success: (m, d) => show(m, 'success', d),
    error: (m, d) => show(m, 'error', d),
    info: (m, d) => show(m, 'info', d),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-80">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`animate-slide-in-right rounded-lg border px-4 py-3 text-sm shadow-lg ${variantClasses(t.variant)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <span>{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="text-current opacity-60 hover:opacity-100 leading-none" aria-label="Dismiss">
                &times;
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function variantClasses(variant) {
  switch (variant) {
    case 'success': return 'bg-white border-success-600/20 text-success-700 shadow-success-600/5';
    case 'error': return 'bg-white border-danger-600/20 text-danger-700 shadow-danger-600/5';
    default: return 'bg-white border-line text-ink-700';
  }
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
