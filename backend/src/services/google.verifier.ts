import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { VerifyGoogleToken } from './auth.service';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Real Google ID-token verifier: RS256 against Google's JWKS, with issuer and
 * audience pinned to our client id. Wired in index.ts only when
 * GOOGLE_CLIENT_ID is set; unit tests inject a fake instead (no network).
 */
export function createGoogleVerifier(clientId: string): VerifyGoogleToken {
  const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return async (credential) => {
    const { payload } = await jwtVerify(credential, jwks, {
      algorithms: ['RS256'],
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
    });
    if (typeof payload.email !== 'string' || !payload.email) {
      throw new Error('Google token has no email claim');
    }
    return {
      email: payload.email,
      givenName: typeof payload.given_name === 'string' ? payload.given_name : '',
      familyName: typeof payload.family_name === 'string' ? payload.family_name : '',
    };
  };
}
