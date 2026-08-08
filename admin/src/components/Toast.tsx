import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastTone = 'success' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** Renders an inline action inside the toast, e.g. "Undo". */
  actionLabel?: string;
  onAction?: () => void;
  /** Override the auto-dismiss delay — an undo window must outlive its toast. */
  duration?: number;
}

type ToastFn = (message: string, opts?: ToastOptions) => void;

interface ToastState {
  msg: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
}

const ToastContext = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback<ToastFn>((msg, opts) => {
    const tone = opts?.tone ?? 'success';
    setCurrent({ msg, tone, actionLabel: opts?.actionLabel, onAction: opts?.onAction });
    window.clearTimeout(timer.current);
    // Errors linger a little longer — they need to be read, not just noticed.
    const ms = opts?.duration ?? (tone === 'error' ? 4000 : 2600);
    timer.current = window.setTimeout(() => setCurrent(null), ms);
  }, []);

  const isError = current?.tone === 'error';
  const runAction = () => {
    const action = current?.onAction;
    window.clearTimeout(timer.current);
    setCurrent(null);
    action?.();
  };

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
            {current.actionLabel && current.onAction && (
              <button type="button" className="ulink toast-action" onClick={runAction}>
                {current.actionLabel}
              </button>
            )}
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
