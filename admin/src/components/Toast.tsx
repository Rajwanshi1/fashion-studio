import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastTone = 'success' | 'error';
type ToastFn = (message: string, opts?: { tone?: ToastTone }) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ msg: string; tone: ToastTone } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback<ToastFn>((msg, opts) => {
    const tone = opts?.tone ?? 'success';
    setCurrent({ msg, tone });
    window.clearTimeout(timer.current);
    // Errors linger a little longer — they need to be read, not just noticed.
    timer.current = window.setTimeout(() => setCurrent(null), tone === 'error' ? 4000 : 2600);
  }, []);

  const isError = current?.tone === 'error';
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className={`toast${current ? ' show' : ''}${isError ? ' err' : ''}`}
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
      >
        {current && (
          <>
            <span className="g">{isError ? '✕' : '✓'}</span>
            <span>{current.msg}</span>
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
