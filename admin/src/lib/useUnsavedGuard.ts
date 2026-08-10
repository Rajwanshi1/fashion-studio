import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

export interface UnsavedGuard {
  /** True while a navigation is being held — render the confirm dialog. */
  blocked: boolean;
  /** Leave anyway, discarding the changes. */
  confirmLeave: () => void;
  /** Stay on the form. */
  stay: () => void;
  /**
   * Disarm before a deliberate post-save navigate() — the save leaves state
   * "dirty" until React flushes, and a ref flip beats the race.
   */
  release: () => void;
}

/**
 * Holds in-app navigation while a form has unsaved changes, and arms the
 * native beforeunload prompt for tab close/refresh (the one case an in-app
 * dialog cannot intercept). Needs the data router (createBrowserRouter).
 */
export function useUnsavedGuard(isDirty: boolean): UnsavedGuard {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const armedRef = useRef(true);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      armedRef.current &&
      dirtyRef.current &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!armedRef.current || !dirtyRef.current) return;
      e.preventDefault();
      // Chrome requires returnValue to be set to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  return {
    blocked: blocker.state === 'blocked',
    confirmLeave: () => blocker.state === 'blocked' && blocker.proceed(),
    stay: () => blocker.state === 'blocked' && blocker.reset(),
    release: () => {
      armedRef.current = false;
    },
  };
}
