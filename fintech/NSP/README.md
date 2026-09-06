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

## The registration gate

Anyone can reach the public form, so five controls stand between it and a
registry record. They are configured in `.env` (see `.env.example`) and covered
by `tests/gate.test.js` and `tests/gate-http.test.js`.

| # | Control | What it stops | Notes |
|---|---------|---------------|-------|
| 1 | **Mobile OTP** before the form is accepted | Registrations for people who do not exist | PTA rules require biometric verification against NADRA before a SIM is issued, so a live Pakistani number is already weakly bound to a CNIC. This proves *control of a number*, not identity. |
| 2 | **Proof of work + honeypot + velocity caps** | Scripted bulk submission | SHA-256 leading-zero-bits puzzle solved in the browser: ~1s for one applicant at the default 16 bits, 65,536 hashes each for ten thousand. No third-party CAPTCHA, so a rural centre with a poor route to a vendor is not locked out. Caps run per IP, per phone and per district. |
| 3 | **Fuzzy duplicate detection** on name + date of birth + father's name | The same person enrolling twice under two documents | Normalises Pakistani name variants (Muhammad/Mohammad/Md, honorifics, initials, token order) and scores candidates 0–100. **Flags for review; never refuses** — genuine namesakes sharing a birthday exist, and refusing them would exclude real applicants. |
| 4 | **Four eyes on issuance** | A single corrupt or careless officer minting credentials | The officer who ran `VERIFY` cannot run `ISSUE`. Disable only for a genuinely single-registrar deployment, via `NSP_FOUR_EYES=0` — an explicit, recorded choice. |
| 5 | **Full audit trail** | Undetectable tampering | Every OTP request, verification, gate rejection, registration, duplicate flag and state change is written to `audit_log` and readable at `GET /api/v1/audit`. Always on; not configurable. |

### Assurance tiers

A record carries the level of proof actually behind it, so a verifier can judge it:

| Tier | Reached by | Meaning |
|------|-----------|---------|
| `NSP-1` | verified mobile + gate | Self-declared identity, contactable person |
| `NSP-2` | registrar sights the CNIC/B-Form at the desk (`VERIFY`) | Document-verified |
| `NSP-3` | *reserved* — NADRA Verisys or biometric match | Not implemented: no NADRA access |

Only `NSP-2` and above may be issued a card.

### SMS gateway

The OTP is only a control if a code actually reaches a handset. `server/lib/sms.js`
has four drivers:

| Provider | Use |
|----------|-----|
| `log` | Writes the code to the service journal. Development, or a supervised desk. |
| `http` | **The one to use in Pakistan.** A declarative driver: give it the URL, method, body, headers and a pattern that identifies success, and it drives any aggregator — Veevo Tech, BulkSMS.pk, an operator's corporate gateway, a reseller. Worked shapes are in `.env.example`. |
| `twilio` | International fallback. A2P delivery into Pakistan is restricted and priced per message. |
| `webhook` | `POST {to, message}` to something you already run. |

Around whichever driver is configured: a timeout, bounded retries with backoff
(4xx is *not* retried — the gateway will refuse it again), optional failover to
`NSP_SMS_FALLBACK_PROVIDER`, and a delivery record. Two details that matter in
the field:

- **Numbers.** `NSP_SMS_NUMBER_FORMAT` reshapes `+923001234567` to `923001234567`
  or `03001234567`. Gateways disagree, and the wrong shape is a common silent failure.
- **Sender mask.** `NSP_SMS_SENDER` must be registered with the aggregator and
  approved by the PTA. An unregistered mask is accepted by the API and then
  dropped by the carrier — which looks like success in every log you own.

**Email fallback.** With no carrier connected, the code goes to the applicant's
email instead of nowhere (`NSP_OTP_EMAIL_FALLBACK=1` plus the `NSP_SMTP_*`
settings). It is never offered as a choice — the server uses it only when SMS
cannot carry the message — because an emailed code proves the applicant reads
that inbox and nothing about who holds the SIM. Such records are stored with
`phoneVerified: false`, `emailVerified: true`, and land in the desk's **No
verified mobile** queue for a registrar to confirm in person. The channel is
signed into the verification token, so an email-channel token cannot be passed
off as an SMS one.

Prove it before a rollout:

```bash
npm run sms:test -- +923001234567          # sends one real message, prints what the carrier said
curl -H "X-Registry-Key: $KEY" .../api/v1/sms/status   # success rate, latency, recent failures
```

The delivery log holds the masked number, provider, outcome, latency and error —
never the code and never the full number. `GET /api/v1/sms/status` is how you tell
a gateway outage from a quiet day; without it the two look identical.

`NSP_OTP_DEV_ECHO=1` returns the code in the API response, and is **ignored** once
a live provider is configured — the service says so at startup rather than
quietly handing every caller the OTP.

### Applicant flow

```
GET  /api/v1/gate/challenge          → { challenge, difficulty }   solve in the browser
POST /api/v1/otp/request  { phone }  → { challengeId }             SMS sent
POST /api/v1/otp/verify   { challengeId, code } → { registrationToken }
POST /api/v1/registrations { ...application, registrationToken, gateChallenge, gateNonce }
```

Each challenge and each token is single use, and the phone on the form must be
the number that was verified.

## The registry desk

`/desk` — sign in with a registry key (held in `sessionStorage`, sent as
`X-Registry-Key`). Five tabs, built around what an officer has to *do* rather
than what the database happens to contain:

- **Overview** — alerts first: a dead SMS gateway, four-eyes switched off,
  duplicates nobody has judged, applicants who asked for a code and never
  entered one. Then the counts, activity over 30 days, desk turnaround
  (median and 90th percentile, with the sample size), the assurance mix, and
  who verified versus who issued.
- **Work queues** — the six lists an officer can act on: awaiting verification,
  verified but not issued, *needs another officer* (four-eyes: records you
  verified yourself), possible duplicates, expiring within 90 days, and records
  with no verified mobile. Queues are ordered **oldest first**, so the longest
  wait is served next.
- **Records** — search and filter by status, type, assurance tier and district;
  CSV export of everything the filters select, not just the visible page.
- **Gate & SMS** — the registration funnel (codes requested → verified →
  registered, with where people drop out), gateway health, and a live test send.
- **Audit trail** — every entry, filterable by action and officer.

Two things the desk shows that the API alone does not make obvious:

- **Four-eyes is announced, not discovered.** Open a record you verified and the
  issue buttons are disabled with the reason, instead of failing with a 409
  after the click.
- **Duplicate flags are comparable.** “Compare side by side” puts the record and
  each candidate in one table with matching fields highlighted, so an officer can
  answer the only question that matters — same person, or two people who share a
  name and a birthday?

## API v1 (summary)

Public
- `GET  /api/v1/reference` · `/reference/{countries|occupations|iscedLevels|…}`
- `GET  /api/v1/gate/challenge` → `{ challenge, difficulty, algorithm }`
- `POST /api/v1/otp/request { phone }` · `POST /api/v1/otp/verify { challengeId, code }`
- `POST /api/v1/registrations` → `201 { nspId, status: SUBMITTED }` (gate evidence required)
- `GET  /api/v1/registrations/{nspId}/status?dob=YYYY-MM-DD`
- `GET  /api/v1/verify/{nspId}[?t=token]` · `GET /api/v1/verify/serial/{serial}`
- `GET  /api/v1/issuer` · `GET /.well-known/did.json`

Registry desk (`X-Registry-Key`)
- `GET  /api/v1/dashboard?days=30` (queues, trends, service levels, gate and SMS health — scoped to the caller)
- `GET  /api/v1/registrations?q=&status=&type=&assurance=&district=&sector=&queue=&limit=&offset=`
  `queue` = `needsVerification|awaitingIssue|secondOfficer|flagged|expiringSoon|unverifiedPhone`
- `GET  /api/v1/registrations/{nspId}/duplicates` (candidates resolved for side-by-side comparison)
- `GET  /api/v1/me` (actor + which controls are live) · `GET /api/v1/stats`
- `GET  /api/v1/registrations/{nspId}` (full record + credentials + audit)
- `PUT  /api/v1/registrations/{nspId}`
- `POST /api/v1/registrations/{nspId}/transition { action: REVIEW|VERIFY|REJECT|ISSUE|SUSPEND|REINSTATE|REVOKE, reason? }`
- `POST /api/v1/registrations/{nspId}/credentials/card` · `/credentials/certificate`
- `GET  /api/v1/registrations/{nspId}/credential.json` (Verifiable Credential)
- `GET  /api/v1/credentials/{serial}`
- `GET  /api/v1/audit?limit=&offset=&actor=&action=` (registry-wide trail, newest first)
- `GET  /api/v1/sms/status` · `POST /api/v1/sms/test { phone }` (gateway health and a live send)

Full field list and lifecycle: [docs/REGISTRY-SPEC.md](docs/REGISTRY-SPEC.md).
Card artwork rules: [docs/CARD-SPEC.md](docs/CARD-SPEC.md). Certificate: [docs/CERTIFICATE-SPEC.md](docs/CERTIFICATE-SPEC.md).

## Deployment notes

- Behind nginx, proxy `/` to port 4100 and set `NSP_PUBLIC_URL` to the public origin —
  it is baked into every QR code.
- Keep `data/signing-key.pem` (or `NSP_SIGNING_KEY_PEM`) in a secret store and back it up;
  losing it invalidates every printed QR.
- For PostgreSQL, apply `server/db/schema.sql` and replace `server/lib/store.js` —
  the rest of the service is store-agnostic.
- Set `NSP_GATE_SECRET` explicitly. It signs OTP hashes, mobile-verification tokens and
  proof-of-work challenges; without it each process generates its own, and a second
  instance rejects the first one's tokens.
- Wire a real SMS gateway before going live (`NSP_SMS_PROVIDER=http` plus the aggregator's
  URL, or `twilio`). The default `log` provider only writes codes to the service journal,
  so nobody outside the box could complete a registration. Confirm with `npm run sms:test`.
- Document binaries are **not** stored by this service; the registration keeps type,
  file name, size and SHA-256 so uploads can be matched to object storage.

## Previews

Start the server and run `npm run render` (headless Chromium) to produce PNGs of the card,
certificate and portal pages under `previews/`. The demo print views also work without the
registry: `/card/demo?demo=1` and `/certificate/demo?demo=1`.
