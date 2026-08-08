import { useCallback, useEffect, useRef } from 'react';
import { api } from './api';
import { ORDER_STATUS_LABELS } from './types';
import type { Order, OrderStatus } from './types';
import { useToast } from '../components/Toast';

/** How long the admin has to undo before the PATCH goes out. */
export const UNDO_WINDOW_MS = 5000;

interface Pending {
  orderId: string;
  prev: OrderStatus;
  next: OrderStatus;
  timer: number;
}

export interface DeferredStatusOptions {
  /** Move the row/badge forward straight away — the tap must feel instant. */
  onApply: (orderId: string, next: OrderStatus) => void;
  /** Put it back: the admin undid, or the PATCH was rejected. */
  onRevert: (orderId: string, prev: OrderStatus) => void;
  onError?: (message: string) => void;
  /** Undo window in ms; exposed for tests. */
  delay?: number;
}

export interface DeferredStatus {
  advance: (order: Order, next: OrderStatus) => void;
}

/**
 * One-tap status advance with an undo window. The UI moves immediately; the
 * PATCH is held for `delay` ms so "Undo" can cancel it outright — the status
 * machine is forward-only, so a committed transition cannot be reversed.
 *
 * A pending transition is never silently dropped: a second advance, unmount or
 * `pagehide` all flush it to the server first.
 */
export function useDeferredStatus(options: DeferredStatusOptions): DeferredStatus {
  const toast = useToast();
  // Latest callbacks, so a flush on unmount never fires a stale closure.
  const optsRef = useRef(options);
  optsRef.current = options;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const pending = useRef<Pending | null>(null);

  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    window.clearTimeout(p.timer);
    void api<Order>(`/api/admin/orders/${p.orderId}`, {
      method: 'PATCH',
      body: { status: p.next },
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unable to update the order';
      optsRef.current.onRevert(p.orderId, p.prev);
      optsRef.current.onError?.(message);
      toastRef.current(message, { tone: 'error' });
    });
  }, []);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const onHide = () => flushRef.current();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flushRef.current();
    };
  }, []);

  const advance = useCallback(
    (order: Order, next: OrderStatus) => {
      // Only one transition can be in flight — commit the previous one first.
      flush();

      const prev = order.status;
      const orderId = order.id;
      const timer = window.setTimeout(() => flushRef.current(), options.delay ?? UNDO_WINDOW_MS);
      pending.current = { orderId, prev, next, timer };
      optsRef.current.onApply(orderId, next);

      toastRef.current(`→ ${ORDER_STATUS_LABELS[next]}`, {
        actionLabel: 'Undo',
        duration: options.delay ?? UNDO_WINDOW_MS,
        onAction: () => {
          const p = pending.current;
          if (!p || p.orderId !== orderId || p.timer !== timer) return; // already committed
          window.clearTimeout(p.timer);
          pending.current = null;
          optsRef.current.onRevert(p.orderId, p.prev);
        },
      });
    },
    [flush, options.delay],
  );

  return { advance };
}
