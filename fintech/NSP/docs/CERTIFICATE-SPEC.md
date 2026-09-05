# NSP Certificate of Registration — Specification

## Format
ISO 216 **A4 portrait** (210 × 297 mm), printed at 100 % with zero margins;
the sheet carries its own frame (navy 0.5 mm rule at 12 mm, gold hairline
inside). 120–160 g/m² security paper recommended; optional dry-embossed seal
over the printed gold seal at bottom right.

## Typography
| Role | Face |
|------|------|
| Title, holder name, lead-in | Spectral (serif) |
| Body, tables, labels | IBM Plex Sans / Plex Sans Condensed |
| NSP ID, serials, hash | B612 Mono |
All faces are self-hosted under `public/assets/fonts` (OFL).

## Content blocks (top → bottom)
1. **Header** — gold registry seal, "NATIONAL SKILL PASSPORT" eyebrow, issuer country and name, title *Certificate of Registration*, authority line, holder photo 30 × 38 mm.
2. **Attestation** — "This is to certify that", full name (native-script name beneath when recorded), birth date, nationality, masked ID number, registrant type, followed by the NSP ID in a gold-ruled box.
3. **Verified skills & qualifications** — numbered table: skill / sector, ISCO-08, NVQF·EQF level (or *Registered*), evidence type with certifying body, certificate number and date. Education (ISCED) and languages (CEFR) as a meta line.
4. **Footer row** — QR (30 mm, signed verification URL) with the verify host; dates: registered, verified (+ officer), certificate issued, valid until, card serial; two signature lines (Registrar, Authorised signatory) with the seal stamp.
5. **Foot line** — certificate number, record hash (SHA-256 of NSP ID + serial + issue time + skill codes), signing key ID, "Void if altered" notice. Microtext strip along the bottom.
6. **Security ground** — light emerald guilloche watermark, gold corner ornaments.

## Data source
`GET /api/v1/credentials/{serial}` (kind `CERTIFICATE`). The print view is
`/certificate/{serial}`; `?demo=1` renders sample data.

## Validity
The certificate mirrors the registry at the moment of issue. Its QR resolves to
live status: a suspended or revoked passport shows as such even if the paper is
intact. Re-issue after renewal or skill changes; the previous certificate is marked
`REPLACED` and its QR reports `CREDENTIAL_REPLACED`.

## Preview
Run `npm start` then `npm run render` to produce PNG previews under `previews/`, or open the `?demo=1` print view in a browser.
