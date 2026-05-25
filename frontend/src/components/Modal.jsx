import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({ open, onClose, size = 'md', children }) {
  useEffect(() => {
    const appRoot = document.getElementById('root')?.firstElementChild;
    if (!appRoot) return;
    if (open) {
      appRoot.style.filter = 'blur(2px)';
      appRoot.style.transition = 'filter 0.2s ease';
    } else {
      appRoot.style.filter = '';
    }
    return () => { appRoot.style.filter = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const maxWidth = size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-sm' : 'max-w-lg';

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 p-4" onClick={onClose}>
      <div className={`card p-6 ${maxWidth} w-full max-h-[75vh] overflow-y-auto animate-scale-in relative shadow-2xl`} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}
