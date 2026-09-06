// Who this deployment says it is when it issues something.
//
// The code was copied from TalentLedger, where the issuer identity was written
// into a dozen files as the literal did:web:tl.ppmc.pk and https://tl.ppmc.pk.
// Left alone, this instance would mint credentials, DID documents and
// verification links in TalentLedger's name — a second system asserting it is
// the first. Every one of those places now reads from here instead.
//
// PUBLIC_BASE is where this tool answers on the public internet, including the
// path it is mounted at. ISSUER_DID is derived from it in did:web form, where
// path segments are colon-separated, so /lms becomes did:web:host:lms.
//
// A did:web identifier is only resolvable once the matching DID document is
// served at <base>/.well-known/did.json. Until that is published, credentials
// issued here carry a correct name that a verifier cannot yet look up.

import env from './env.js';

export const PUBLIC_BASE = (process.env.PUBLIC_BASE || env.CLIENT_URL || 'https://nsp.ppmc.pk/lms').replace(/\/+$/, '');

export const ISSUER_DID = process.env.ISSUER_DID || (() => {
  try {
    const u = new URL(PUBLIC_BASE);
    const path = u.pathname.split('/').filter(Boolean).join(':');
    return `did:web:${u.host}${path ? ':' + path : ''}`;
  } catch {
    return 'did:web:nsp.ppmc.pk:lms';
  }
})();

export const ISSUER_NAME = process.env.ISSUER_NAME || 'NSP Learning';

export default { PUBLIC_BASE, ISSUER_DID, ISSUER_NAME };
