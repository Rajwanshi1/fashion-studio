import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={message ? 'toast show' : 'toast'} role="status" aria-live="polite">
        {message && (
          <>
            <span className="g">✓</span>
            <span>{message}</span>
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
