# National Skill Passport (NSP) — Registry

The registry component of the National Skill Passport: an international-grade
registration, verification and credential-issuance service for **students,
apprentices, skilled workers and professionals**. It is the "registry part"
of TalentLedger (tl.ppmc.pk) rebuilt as a standalone, standards-aligned
module.

```
fintech/NSP
├─ server/            Express API + SQLite store (Node ≥ 22.5, zero native deps)
│  ├─ lib/nspId.js     NSP identifier: NSP-CC-YY-NNNNNNN-K (ISO/IEC 7064 MOD 37,36 check)
│  ├─ lib/mrz.js       ICAO 9303 TD1 machine-readable zone for the card back
│  ├─ lib/signer.js    Ed25519 signing of QR tokens and W3C Verifiable Credentials
│  ├─ lib/validation.js  Registration schema (ISO 3166, ISCO-08, ISCED, NVQF/EQF, CEFR, E.164)
│  ├─ lib/registry.js  Lifecycle, card & certificate issuance, public verification
│  ├─ lib/store.js     node:sqlite data access (mirrors db/schema.sql for PostgreSQL)
│  ├─ routes/api.js    REST API v1
│  └─ data/            Reference data (249 countries, ISCO-08, ISCED 2011/-F 2013, CEFR…)
├─ public/            Portal: registration wizard, verification, tracking, registry desk,
│                     PVC card print view, certificate print view (self-hosted fonts)
├─ docs/              REGISTRY-SPEC, CARD-SPEC, CERTIFICATE-SPEC
├─ tests/             node:test suite (ID scheme, MRZ, full API lifecycle)
└─ scripts/           country-list generator, preview renderer
```

## Quick start

```bash
cd fintech/NSP
npm install
cp .env.example .env            # set NSP_PUBLIC_URL and NSP_REGISTRY_KEYS
npm run seed                    # optional: sample records in every lifecycle state
npm start                       # http://localhost:4100
npm test
```

| Page | URL | Who |
|------|-----|-----|
| Portal | `/` | public |
| Registration wizard (6 steps) | `/register` | students / workers |
| Track application (NSP ID + DOB) | `/track` | applicants |
| Public verification (QR target) | `/verify/{NSP-ID}?t={token}` | employers, embassies |
| Registry desk | `/desk` | registry officers (`X-Registry-Key`) |
| PVC card print view | `/card/{serial}` · demo: `/card/demo?demo=1` | card printer |
| Certificate print view | `/certificate/{serial}` · demo: `/certificate/demo?demo=1` | registry |
| Issuer key document | `/.well-known/did.json` | verifiers |

Default dev registry key is `dev-registrar-key` (a warning is logged). Set
`NSP_REGISTRY_KEYS=name:key,...` in production.

## What "international level" means here

| Concern | Standard applied |
|---------|------------------|
| Identifier | `NSP-PK-26-0000123-Y` — ISO 3166-1 alpha-2 issuer, year, 7-digit sequence, **ISO/IEC 7064 MOD 37,36** check character (catches 100 % of single-character errors and adjacent transpositions; verified against python-stdnum) |
| Card | **ISO/IEC 7810 ID-1** 85.60 × 53.98 mm, r = 3.18 mm, optional 3 mm bleed, optional ISO 7816-2 chip footprint |
| Machine readable zone | **ICAO Doc 9303** TD1 layout (3 × 30 OCR characters, 7-3-1 check digits, ICAO transliteration), private document code `NS` |
| Occupations | **ILO ISCO-08** 4-digit unit groups |
| Education | **UNESCO ISCED 2011** levels, **ISCED-F 2013** fields |
| Qualification level | Pakistan **NVQF** 1–8 mapped to **EQF** 1–8 |
| Languages | ISO 639 codes + **CEFR** A1–C2 |
| Countries / nationality | ISO 3166-1 alpha-2 (storage) and alpha-3 (card, MRZ) |
| Phone | ITU-T **E.164** |
| Sex | ICAO 9303 `M / F / X` |
| Minimum age | ILO Convention 138 (14 years) |
| Digital credential | **W3C Verifiable Credentials 2.0** with `eddsa-jcs-2022` Data Integrity proof; issuer key published as **Multikey** on `/.well-known/did.json` |
| QR / offline check | Ed25519 (RFC 8032) signed compact token — name, NSP ID, serial, expiry, occupation; **no** date of birth or ID number inside the QR |
| Privacy | Public verification exposes name, photo, nationality, birth year, skills and status only; consent captured per purpose (processing, employer verification, cross-border sharing) |

## API v1 (summary)

Public
- `GET  /api/v1/reference` · `/reference/{countries|occupations|iscedLevels|…}`
- `POST /api/v1/registrations` → `201 { nspId, status: SUBMITTED }`
- `GET  /api/v1/registrations/{nspId}/status?dob=YYYY-MM-DD`
- `GET  /api/v1/verify/{nspId}[?t=token]` · `GET /api/v1/verify/serial/{serial}`
- `GET  /api/v1/issuer` · `GET /.well-known/did.json`

Registry desk (`X-Registry-Key`)
- `GET  /api/v1/registrations?q=&status=&type=&limit=&offset=` · `GET /api/v1/stats`
- `GET  /api/v1/registrations/{nspId}` (full record + credentials + audit)
- `PUT  /api/v1/registrations/{nspId}`
- `POST /api/v1/registrations/{nspId}/transition { action: REVIEW|VERIFY|REJECT|ISSUE|SUSPEND|REINSTATE|REVOKE, reason? }`
- `POST /api/v1/registrations/{nspId}/credentials/card` · `/credentials/certificate`
- `GET  /api/v1/registrations/{nspId}/credential.json` (Verifiable Credential)
- `GET  /api/v1/credentials/{serial}`

Full field list and lifecycle: [docs/REGISTRY-SPEC.md](docs/REGISTRY-SPEC.md).
Card artwork rules: [docs/CARD-SPEC.md](docs/CARD-SPEC.md). Certificate: [docs/CERTIFICATE-SPEC.md](docs/CERTIFICATE-SPEC.md).

## Deployment notes

- Behind nginx, proxy `/` to port 4100 and set `NSP_PUBLIC_URL` to the public origin —
  it is baked into every QR code.
- Keep `data/signing-key.pem` (or `NSP_SIGNING_KEY_PEM`) in a secret store and back it up;
  losing it invalidates every printed QR.
- For PostgreSQL, apply `server/db/schema.sql` and replace `server/lib/store.js` —
  the rest of the service is store-agnostic.
- Document binaries are **not** stored by this service; the registration keeps type,
  file name, size and SHA-256 so uploads can be matched to object storage.

## Previews

Start the server and run `npm run render` (headless Chromium) to produce PNGs of the card,
certificate and portal pages under `previews/`. The demo print views also work without the
registry: `/card/demo?demo=1` and `/certificate/demo?demo=1`.
