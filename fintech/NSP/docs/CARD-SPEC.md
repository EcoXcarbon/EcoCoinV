# NSP PVC Card — Artwork & Production Specification

## Physical
| Item | Value |
|------|-------|
| Format | ISO/IEC 7810 **ID-1**: 85.60 × 53.98 mm, corner radius 3.18 mm, 0.76 mm PVC/PETG |
| Bleed | 3 mm on all sides (`?bleed=1` → 91.60 × 59.98 mm) |
| Safe zone | 3 mm inside the trim; all text and the QR stay inside it |
| Print | CMYK; navy `#0B2545` ≈ C100 M80 Y35 K30, emerald `#0E9F6E` ≈ C80 M0 Y70 K10, gold `#C9A227` ≈ C20 M30 Y100 K5 (or metallic Pantone 871 for the seal) |
| Finish | UV-cured overlay; hologram patch 10 × 10 mm over the seal position (optional) |
| Chip | ISO/IEC 7816-2 contact footprint at 10.25 mm from left, 19.23 mm from top (`?chip=1`). The footprint overlaps the photo zone; a hybrid smart-card edition needs the photo moved to the right column (v2 layout) |
| Magstripe | ISO/IEC 7811 track area on the back (`?mag=1`) — disabled by default |

## Front
| Zone | Position (from trim) | Content |
|------|----------------------|---------|
| Vertical band | x 0–6.5 mm | navy→emerald gradient, "NATIONAL SKILL PASSPORT" rotated |
| Header | x 9.5–82.6, y 3–12 mm | issuer title, country + registry name, gold seal, national flag |
| Photo | x 9.5–30.5, y 13.2–40.2 mm (21 × 27 mm) | colour photo, 420 × 540 px source |
| Type tag | under photo | STUDENT / APPRENTICE / WORKER / PROFESSIONAL |
| Name | x 33 – 72 mm | uppercase Latin, auto-fits down to 3.0 mm for long names |
| NSP ID | | OCR-style, `NSP-PK-26-0000123-Y` |
| Primary skill | | title + ISCO-08 code |
| Level / Nationality·Sex | | `NVQF 3 · EQF 3` / `PAK · M` |
| DOB / Issued / Skills / Valid until | x 33–67 mm | ISO 8601 dates |
| QR | x 68.6–82.6, y 37–51 mm (14 mm) | signed verification URL, EC level M |
| Ghost image | x 73.6–82.6, y 12.8–24.3 mm | greyscale duplicate of the photo (anti-substitution) |
| Microtext | bottom edge, 0.75 mm | repeated NSP ID |
| Guilloche | full face, 35 % opacity | rose curves, emerald |

## Back
| Zone | Content |
|------|---------|
| Terms | ownership / return statement, "not an identity or travel document" |
| Verify block | `nsp.ppmc.pk/verify` + NSP ID |
| Registered skills | up to 4 skills with ISCO code and level |
| Signature strip | 24 × 7 mm |
| Card serial | `C260000123` |
| MRZ | 3 lines × 30 chars, OCR-B-class monospace at 2.54 mm pitch, lower 15.4 mm, white ground |

### MRZ layout (ICAO 9303 TD1, document code `NS`)
```
Line 1  NS PAK 260000123 3 PKY C260000123<<        DOC ISSUER DOCNUM CHK  OPT(NSP country+check, card serial)
Line 2  980412 0 M 310904 7 PAK <<<<<<<<<<< 6      DOB CHK SEX EXP CHK NAT OPT COMPOSITE
Line 3  KHAN<<MUHAMMAD<ALI<<<<<<<<<<<<             FAMILY<<GIVEN<GIVEN
```
Check digits use ICAO 7-3-1 weighting; names use ICAO transliteration (Ø→OE, ß→SS…).
Use a true OCR-B face on the production RIP; the web view ships B612 Mono as a
metrically similar stand-in.

## Data source
`GET /api/v1/credentials/{serial}` → `payload` (holder, primarySkill, skillsBack,
issuer, mrz, verifyUrl, dates). The print view `/card/{serial}` renders it; print
at 100 % with `@page` sized to the card. `?side=front|back` prints one face.

## Quality checks before dispatch
1. Scan QR with a phone: must open `/verify/{NSP-ID}` and show **Valid passport · Ed25519 signature verified**.
2. Read the MRZ with any passport reader: all three check digits must pass.
3. Name on face = line 3 of MRZ; expiry on face = line 2 expiry.
4. Serial on back = `s` field of the QR token.

## Preview
Run `npm start` then `npm run render` to produce PNG previews under `previews/`, or open the `?demo=1` print view in a browser.
