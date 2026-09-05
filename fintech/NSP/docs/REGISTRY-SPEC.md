# NSP Registry — Functional Specification

## 1. Scope
The registry records a person once, assigns a permanent NSP ID, verifies their
identity and skills evidence, and issues credentials (PVC card, certificate,
verifiable credential) whose live status anyone can check. It does **not**
run training, assessment or job matching — those systems reference the NSP ID.

## 2. Registrant types
| Code | Who | Extra mandatory data |
|------|-----|----------------------|
| `STUDENT` | enrolled in an institution / TVET programme | current institution, programme, enrollment number |
| `APPRENTICE` | registered apprenticeship | same as student |
| `WORKER` | employed / self-employed in a trade | — |
| `PROFESSIONAL` | degree-level occupation | — |

## 3. Identifier
`NSP-<CC>-<YY>-<NNNNNNN>-<K>`

* `CC` issuing registry country, ISO 3166-1 alpha-2 (`NSP_ISSUER_COUNTRY`)
* `YY` year of first registration
* `NNNNNNN` sequence, unique per (CC, YY), allocated in a transaction
* `K` ISO/IEC 7064 MOD 37,36 check character over `CCYYNNNNNNN`

The ID never changes: renewals, reprints and status changes keep it. Input is
accepted in any case, with or without separators (`nsp pk 26 0000123 y`).

## 4. Registration record
```
type, channel, preferredLanguage
identity   givenNames*, familyName*, nameNative, fatherOrGuardianName, dateOfBirth* (≥14 y),
           sex* (M/F/X), nationality* (alpha-2), countryOfBirth, placeOfBirth,
           idDocumentType* (CNIC|PASSPORT|NATIONAL_ID|B_FORM), idDocumentNumber*, idDocumentExpiry,
           passportNumber (ICAO 6–9), passportExpiry, photo* (data URL jpeg/png/webp ≤ 400 KB)
contact    email*, phone* (E.164), altPhone, address{line1*, line2, city*, region, postalCode, country*},
           emergencyContact{name, relationship, phone}
education  highestLevel* (ISCED 0–8), field (ISCED-F 00–10), institution, qualificationTitle, yearCompleted,
           currentInstitution, currentProgramme, enrollmentNumber, expectedCompletion
skills[]*  iscoCode* (4-digit), title*, sector, nvqfLevel (1–8), evidenceType*
           (CERTIFICATE|ASSESSMENT|LICENCE|EXPERIENCE|PORTFOLIO), certifyingBody (required for
           CERTIFICATE/LICENCE/ASSESSMENT), certificateNumber, issuedOn, expiresOn, yearsExperience, primary
languages[] code (ISO 639), level (CEFR A1–C2 | NATIVE)
experience[] employer*, country, role*, iscoCode, from*, to | current, referenceContact
documents[] type, fileName, mime, size, sha256, storageKey   (metadata only)
consent    dataProcessing*, employerVerification, crossBorderSharing, declarationTruthful*, termsVersion, consentedAt
```
`*` = required. Uniqueness: one record per (nationality, idDocumentType, idDocumentNumber).

## 5. Lifecycle
```
SUBMITTED ─REVIEW─▶ UNDER_REVIEW ─VERIFY─▶ VERIFIED ─ISSUE─▶ ISSUED ─SUSPEND─▶ SUSPENDED
    │                   │                      │                │  ◀─REINSTATE─┘
    └──────REJECT───────┴──▶ REJECTED          └────REVOKE──────┴──▶ REVOKED
                                                                └──(clock)──▶ EXPIRED ─ISSUE─▶ ISSUED
```
* `ISSUE` sets `issuedAt` and `expiresAt = issuedAt + NSP_CARD_VALIDITY_YEARS` (default 5).
* Issuing a card from `VERIFIED`/`EXPIRED` performs `ISSUE` implicitly.
* `REJECT`, `SUSPEND`, `REVOKE` require a reason; `REVOKE` also revokes all active credentials.
* Expiry is applied lazily on read; expired records can be re-issued (renewal).
* Every transition is written to `audit_log` with the acting officer.

## 6. Credentials
| Kind | Serial | Contents | Replacement |
|------|--------|----------|-------------|
| CARD | `C<YY><NNNNNNN>` | print snapshot, MRZ, signed QR token | reprint marks the previous card `REPLACED`; its QR then verifies as `CREDENTIAL_REPLACED` |
| CERTIFICATE | `NSP-CERT-<YY>-<NNNNNNN>` | skills table, education, languages, record hash, signed QR token | same |
| Verifiable Credential | `{publicUrl}/credentials/{nspId}` | W3C VC 2.0 JSON-LD, `eddsa-jcs-2022` proof | regenerated on demand |

### QR token
`base64url(JSON payload) . base64url(Ed25519 signature)` inside
`{NSP_PUBLIC_URL}/verify/{nspId}?t=…`. Payload: `{v, i: nspId, s: serial, k: C|T, e: YYYYMMDD expiry, n: "FAMILY, GIVEN", o: isco}`.
Deliberately excludes date of birth and ID numbers. A verifier holding the
issuer's public key (`/.well-known/did.json`) can check the signature offline and
confirm the printed face matches; the online call adds live status.

## 7. Public verification results
`VALID · SUSPENDED · EXPIRED · REVOKED · NOT_ISSUED · NOT_FOUND · MALFORMED_ID · INVALID_SIGNATURE · TOKEN_MISMATCH · CREDENTIAL_REPLACED · CREDENTIAL_REVOKED`

Returned record (public view): name, photo, nationality, birth **year**, type,
status, skills (code, title, level, evidence, body), languages, issue/expiry
dates, credential serial/status. Never: ID numbers, contact details, address,
documents.

## 8. Roles & security
* **Applicant** — `POST /registrations`, `GET /registrations/{id}/status?dob=` (NSP ID + DOB as shared secret).
* **Registry officer** — everything under `X-Registry-Key`; keys are named so the audit trail records who acted.
* Rate limiting on public endpoints; JSON body limit 1 MB; timing-safe key comparison; security headers.
* Photos are stored inline (≤ 400 KB); document binaries belong in object storage keyed by `storageKey`.

## 9. Data retention (recommended policy)
Rejected applications: purge after 12 months. Revoked records: retain identifier,
status and reason indefinitely (prevents re-registration), purge personal data after
statutory period. Verification log: 24 months.
