// First-order offer: one fetch per signed-in session, shared by the PDP,
// cart, checkout and the pop-up via a module-level cache.

import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';

export interface FirstOrderOffer {
  eligible: boolean;
  percentOff: number;
}

let cache: { token: string; promise: Promise<FirstOrderOffer> } | null = null;

function fetchOffer(token: string): Promise<FirstOrderOffer> {
  if (cache?.token !== token) {
    const promise = api.get<FirstOrderOffer>('/api/orders/me/first-order-offer');
    cache = { token, promise };
    promise.catch(() => {
      if (cache?.promise === promise) cache = null; // let a later mount retry
    });
  }
  return cache.promise;
}

/** Test seam — the module cache outlives a test's fetch mock. */
export function resetFirstOrderOfferCache(): void {
  cache = null;
}

/** null for guests and while loading; the offer once it lands. Display-only —
 *  the server recomputes eligibility inside the order transaction. */
export function useFirstOrderOffer(): FirstOrderOffer | null {
  const { token } = useAuth();
  const [offer, setOffer] = useState<FirstOrderOffer | null>(null);

  useEffect(() => {
    if (!token) {
      setOffer(null);
      return;
    }
    let live = true;
    fetchOffer(token)
      .then((o) => live && setOffer(o))
      .catch(() => live && setOffer(null)); // the offer is decorative — fail quiet
    return () => {
      live = false;
    };
  }, [token]);

  return token ? offer : null;
}
