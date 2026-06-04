import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const ToastContext = createContext(null);

const typeColors = {
  success: 'var(--success)',
  error: 'var(--danger)',
  info: 'var(--accent)',
};

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 3000;

/**
 * Provides toast notification context to the app.
 * Wrap your app with <ToastProvider> to enable useToast().
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ message, type = 'info' }) => {
      const id = ++idRef.current;

      setToasts((prev) => {
        const next = [...prev, { id, message, type }];
        // Enforce max visible toasts — remove oldest
        if (next.length > MAX_TOASTS) {
          return next.slice(next.length - MAX_TOASTS);
        }
        return next;
      });

      // Auto-dismiss
      setTimeout(() => {
        removeToast(id);
      }, AUTO_DISMISS_MS);
    },
    [removeToast]
  );

  const containerStyle = {
    position: 'fixed',
    top: '1.5rem',
    right: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    zIndex: 9999,
    pointerEvents: 'none',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={containerStyle}>
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }) {
  const color = typeColors[toast.type] || typeColors.info;

  const style = {
    padding: '0.875rem 1.25rem',
    borderRadius: '0.75rem',
    background: `color-mix(in srgb, ${color} 15%, transparent)`,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
    color: 'var(--text)',
    fontSize: '0.875rem',
    fontWeight: 500,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
    pointerEvents: 'auto',
    cursor: 'pointer',
    maxWidth: '360px',
    minWidth: '240px',
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      style={style}
      onClick={onDismiss}
    >
      {toast.message}
    </motion.div>
  );
}

/**
 * Hook to trigger toast notifications.
 * Returns { toast } where toast({ message, type }) shows a notification.
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export default ToastProvider;
