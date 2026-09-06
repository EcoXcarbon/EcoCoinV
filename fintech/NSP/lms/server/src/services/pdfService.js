import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import env from '../config/env.js';
import { PUBLIC_BASE } from '../config/identity.js';

const UPLOADS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
// Read a signature image (stored at /api/uploads/<file>) from disk. Returns null if missing.
function loadSignatureBuffer(url) {
  if (!url) return null;
  try {
    const file = (url.split('/').pop() || '').split('?')[0];
    const p = path.join(UPLOADS_DIR, file);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  } catch { /* ignore */ }
  return null;
}

// Load an image by absolute/local path OR by uploads filename/URL. Used for
// partner logos on certificates (works both in-container and for local regen).
function loadImageBuffer(ref) {
  if (!ref) return null;
  try {
    if (fs.existsSync(ref)) return fs.readFileSync(ref);
    const file = (String(ref).split('/').pop() || '').split('?')[0];
    const p = path.join(UPLOADS_DIR, file);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  } catch { /* ignore */ }
  return null;
}

// ─── Colour palette ─────────────────────────────────────────────────────────
const NAVY   = '#002D72';
const GOLD   = '#C8952E';
const SLATE  = '#1E293B';
const GREY   = '#6B7280';
const LGREY  = '#E5E7EB';
const WHITE  = '#FFFFFF';
const GREEN  = '#166534';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
}

function cap(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, ' ');
}

/** Fetch a remote URL as a Buffer (http or https) */
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Draw guilloché wave-pattern background across full page */
function drawGuilloché(doc, w, h) {
  doc.save();
  doc.opacity(0.045);
  const waveCount = 18;
  const step = h / waveCount;
  doc.lineWidth(0.6).strokeColor(NAVY);
  for (let i = 0; i <= waveCount; i++) {
    const y0 = i * step;
    doc.moveTo(0, y0);
    const pts = 80;
    for (let j = 1; j <= pts; j++) {
      const x = (w / pts) * j;
      const freq = 3 + (i % 4);
      const amp = 4 + (i % 3) * 2;
      const y = y0 + Math.sin((j / pts) * Math.PI * 2 * freq + i) * amp;
      j === 1 ? doc.moveTo(0, y0) : null;
      doc.lineTo(x, y);
    }
    doc.stroke();
  }
  // Cross-hatch
  doc.lineWidth(0.4);
  for (let i = 0; i <= waveCount; i++) {
    const x0 = i * (w / waveCount);
    doc.moveTo(x0, 0);
    const pts = 60;
    for (let j = 1; j <= pts; j++) {
      const y = (h / pts) * j;
      const freq = 2 + (i % 3);
      const amp = 3 + (i % 2) * 2;
      const x = x0 + Math.sin((j / pts) * Math.PI * 2 * freq + i * 0.5) * amp;
      doc.lineTo(x, y);
    }
    doc.stroke();
  }
  doc.restore();
}

/** Draw logo placeholder (used when actual logo file unavailable) */
function drawLogoBlock(doc, x, y, size, label, color) {
  doc.save();
  doc.roundedRect(x, y, size, size, 4).fillColor(color).fill();
  doc.fontSize(6).fillColor(WHITE).font('Helvetica-Bold')
    .text(label, x, y + size / 2 - 3, { width: size, align: 'center' });
  doc.restore();
}

/** Draw a thin horizontal rule */
function rule(doc, x, y, w2, color = GOLD, lw = 1.5) {
  doc.moveTo(x, y).lineTo(x + w2, y).lineWidth(lw).strokeColor(color).stroke();
}

/** Draw a filled label + value row */
function infoRow(doc, lx, vx, y, label, value, lw = 80) {
  doc.fontSize(8).fillColor(GREY).font('Helvetica').text(label, lx, y, { width: lw });
  doc.fontSize(8).fillColor(SLATE).font('Helvetica-Bold').text(value || '—', vx, y);
}

// ─── ENHANCED CERTIFICATE (Landscape A4) ────────────────────────────────────

export async function generateCertificatePDF(credential, stream) {
  // Pre-generate QR as PNG buffer
  const verifyUrl = `${env.CLIENT_URL || 'https://talentledger.ppmc.org.pk'}/verify/${credential.credentialId}`;
  const qrBuffer = await QRCode.toBuffer(verifyUrl, {
    type: 'png',
    width: 160,
    margin: 1,
    errorCorrectionLevel: 'H',
    color: { dark: NAVY, light: WHITE },
  });

  // Fetch worker photo if present (URL stored in worker.photo)
  let photoBuffer = null;
  if (credential.worker?.photo) {
    try {
      const photoUrl = credential.worker.photo.startsWith('http')
        ? credential.worker.photo
        : `${env.API_URL || 'http://localhost:5000'}${credential.worker.photo}`;
      photoBuffer = await fetchBuffer(photoUrl);
    } catch { /* no photo — continue */ }
  }

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 }, info: {
    Title: `TalentLedger Certificate — ${credential.credentialId}`,
    Author: 'PPMC KP / TalentLedger',
    Subject: `Skills Credential: ${cap(credential.trade)}`,
  }});
  doc.pipe(stream);

  const W = doc.page.width;   // ~841
  const H = doc.page.height;  // ~595
  const M = 30; // outer margin

  // ── Background ──────────────────────────────────────────────────────────────
  doc.rect(0, 0, W, H).fillColor('#F8FAFC').fill();
  drawGuilloché(doc, W, H);

  // ── Left colour band ────────────────────────────────────────────────────────
  doc.rect(0, 0, 8, H).fillColor(NAVY).fill();
  doc.rect(W - 8, 0, 8, H).fillColor(NAVY).fill();

  // ── Outer border ────────────────────────────────────────────────────────────
  doc.rect(M, M, W - M * 2, H - M * 2).lineWidth(2.5).strokeColor(NAVY).stroke();
  doc.rect(M + 6, M + 6, W - (M + 6) * 2, H - (M + 6) * 2).lineWidth(1).strokeColor(GOLD).stroke();

  // ── Header bar ──────────────────────────────────────────────────────────────
  const hdrH = 70;
  doc.rect(M + 7, M + 7, W - (M + 7) * 2, hdrH).fillColor(NAVY).fill();

  // Logo blocks
  drawLogoBlock(doc, M + 16, M + 14, 54, 'PPMC\nKP', GOLD);
  drawLogoBlock(doc, W - M - 70, M + 14, 54, 'NAVTTC', '#1D4ED8');

  // Header text
  doc.fontSize(15).fillColor(WHITE).font('Helvetica-Bold')
    .text('NATIONAL SKILLS CERTIFICATE', M + 80, M + 20, { width: W - 200, align: 'center' });
  const issuerLine = (credential.issuers && credential.issuers.length)
    ? credential.issuers.join('   |   ')
    : 'Pakistan Provincial Manpower Council — Khyber Pakhtunkhwa  |  TalentLedger Skills Passport';
  doc.fontSize(9).fillColor(GOLD).font('Helvetica')
    .text(issuerLine, M + 80, M + 42, { width: W - 200, align: 'center' });
  // English subtitle — the built-in Helvetica font has no Arabic/Urdu glyphs, so
  // an Urdu line renders as mojibake. Keep it Latin-1 to render cleanly.
  doc.fontSize(8).fillColor('#93C5FD').font('Helvetica')
    .text('Skills Passport  ·  Verified Micro-Credential', M + 80, M + 57, { width: W - 200, align: 'center' });

  // ── Body layout ─────────────────────────────────────────────────────────────
  const bodyY = M + hdrH + 20;

  // Photo column (left)
  const photoX = M + 20;
  const photoW = 110;
  const photoH = 135;
  doc.rect(photoX, bodyY, photoW, photoH).lineWidth(1).strokeColor(LGREY).stroke();
  if (photoBuffer) {
    doc.image(photoBuffer, photoX + 2, bodyY + 2, { width: photoW - 4, height: photoH - 4, cover: [photoW - 4, photoH - 4] });
  } else {
    // Placeholder silhouette
    doc.rect(photoX, bodyY, photoW, photoH).fillColor('#E2E8F0').fill();
    doc.fontSize(7).fillColor(GREY).font('Helvetica').text('PHOTO', photoX, bodyY + photoH / 2 - 4, { width: photoW, align: 'center' });
  }
  // Photo border gold
  doc.rect(photoX - 1, bodyY - 1, photoW + 2, photoH + 2).lineWidth(1).strokeColor(GOLD).stroke();

  // NQF level badge below photo
  const nqfY = bodyY + photoH + 8;
  doc.roundedRect(photoX, nqfY, photoW, 22, 3).fillColor(NAVY).fill();
  doc.fontSize(7).fillColor(GOLD).font('Helvetica-Bold')
    .text(`NQF LEVEL  ${credential.nqfLevel || 2}`, photoX, nqfY + 7, { width: photoW, align: 'center' });

  // EQF badge
  const eqfY = nqfY + 28;
  doc.roundedRect(photoX, eqfY, photoW, 20, 3).fillColor('#1D4ED8').fill();
  const eqfLevel = credential.nqfLevel || 2;
  doc.fontSize(7).fillColor(WHITE).font('Helvetica-Bold')
    .text(`EQF LEVEL  ${eqfLevel}`, photoX, eqfY + 6, { width: photoW, align: 'center' });

  // ── Centre content ───────────────────────────────────────────────────────────
  const cx = photoX + photoW + 22;
  const cw = W - cx - 220; // leave room for QR column

  // Certify text
  doc.fontSize(10).fillColor(GREY).font('Helvetica')
    .text('This is to certify that', cx, bodyY, { width: cw });

  // Worker name
  const wName = credential.worker?.fullName || 'Worker Name';
  doc.fontSize(22).fillColor(SLATE).font('Helvetica-Bold')
    .text(wName.toUpperCase(), cx, bodyY + 18, { width: cw });

  // Father name
  const fName = credential.worker?.fatherName ? `S/O: ${credential.worker.fatherName}` : '';
  if (fName) {
    doc.fontSize(9).fillColor(GREY).font('Helvetica').text(fName, cx, bodyY + 48, { width: cw });
  }

  // Competency line
  doc.fontSize(10).fillColor(GREY).font('Helvetica')
    .text('has been assessed and awarded the competency of', cx, bodyY + 64, { width: cw });

  // Trade + Level
  const tradeLine = `${cap(credential.trade)}`;
  doc.fontSize(20).fillColor(NAVY).font('Helvetica-Bold')
    .text(tradeLine, cx, bodyY + 82, { width: cw });

  rule(doc, cx, bodyY + 112, cw - 10, GOLD, 1);

  // Alignment tags
  doc.fontSize(8).fillColor(GREY).font('Helvetica')
    .text('in accordance with Pakistan\'s National Qualifications Framework (NVQF) and aligned with', cx, bodyY + 120, { width: cw });
  doc.fontSize(8).fillColor(NAVY).font('Helvetica-Bold')
    .text(`ISCO-08: ${credential.iscoCode || '—'}   |   ISCED-F: ${credential.iscedCode || '—'}   |   EQF Level: ${eqfLevel}`, cx, bodyY + 134, { width: cw });

  rule(doc, cx, bodyY + 150, cw - 10, LGREY, 0.5);

  // Info grid — two columns
  const col1x = cx;
  const col2x = cx + (cw / 2);
  const igY = bodyY + 160;

  infoRow(doc, col1x, col1x + 95, igY,      'Credential ID:',   credential.credentialId);
  infoRow(doc, col1x, col1x + 95, igY + 16, 'Registration No:', credential.worker?.registrationId || '—');
  infoRow(doc, col1x, col1x + 95, igY + 32, 'CNIC:', credential.worker?.cnicMasked || '****-*******-*');
  infoRow(doc, col1x, col1x + 95, igY + 48, 'Assessed By:', credential.institution || 'PPMC Peshawar');

  infoRow(doc, col2x, col2x + 75, igY,      'Issue Date:', fmt(credential.validFrom));
  infoRow(doc, col2x, col2x + 75, igY + 16, 'Valid Until:', fmt(credential.validUntil));
  infoRow(doc, col2x, col2x + 75, igY + 32, 'District:', cap(credential.worker?.district) || '—');
  infoRow(doc, col2x, col2x + 75, igY + 48, 'Type:', cap(credential.type));

  // Blockchain line
  const bcY = igY + 70;
  const txHash = credential.blockchain?.txHash || null;
  const chain  = credential.blockchain?.chain || 'simulated';
  const chainLabel = chain === 'polygon' ? 'Polygon PoS' : chain === 'ethereum' ? 'Ethereum' : 'Simulated';

  if (txHash) {
    const shortTx = txHash.length > 16 ? `${txHash.slice(0, 10)}...${txHash.slice(-6)}` : txHash;
    doc.roundedRect(cx, bcY, cw - 10, 20, 3).fillColor('#F0FDF4').fill();
    doc.roundedRect(cx, bcY, cw - 10, 20, 3).lineWidth(0.5).strokeColor('#22C55E').stroke();
    doc.fontSize(7.5).fillColor(GREEN).font('Helvetica-Bold')
      .text(`Blockchain Anchored  |  ${chainLabel}  |  Tx: ${shortTx}`, cx + 6, bcY + 6, { width: cw - 20 });
  } else {
    doc.roundedRect(cx, bcY, cw - 10, 20, 3).fillColor('#EFF6FF').fill();
    doc.fontSize(7.5).fillColor('#1D4ED8').font('Helvetica')
      .text(`Blockchain: ${chainLabel}  |  Pending Anchoring`, cx + 6, bcY + 6, { width: cw - 20 });
  }

  // ── QR + right column ────────────────────────────────────────────────────────
  const qrColX = W - M - 185;
  const qrColW = 165;

  // QR box
  doc.roundedRect(qrColX, bodyY, qrColW, qrColW, 6).fillColor(WHITE).fill();
  doc.roundedRect(qrColX, bodyY, qrColW, qrColW, 6).lineWidth(1).strokeColor(GOLD).stroke();
  doc.image(qrBuffer, qrColX + (qrColW - 140) / 2, bodyY + 10, { width: 140, height: 140 });
  doc.fontSize(7).fillColor(GREY).font('Helvetica')
    .text('Scan to verify online', qrColX, bodyY + 152, { width: qrColW, align: 'center' });

  // Credential ID below QR
  doc.fontSize(7).fillColor(NAVY).font('Helvetica-Bold')
    .text(credential.credentialId, qrColX, bodyY + 165, { width: qrColW, align: 'center' });

  // Status badge
  const statusBgColor = credential.status === 'active' ? '#D1FAE5' : '#FEE2E2';
  const statusTxColor = credential.status === 'active' ? GREEN : '#B91C1C';
  const statusLabel   = (credential.status || 'active').toUpperCase();
  doc.roundedRect(qrColX + 20, bodyY + 178, qrColW - 40, 18, 3).fillColor(statusBgColor).fill();
  doc.fontSize(8).fillColor(statusTxColor).font('Helvetica-Bold')
    .text(statusLabel, qrColX + 20, bodyY + 183, { width: qrColW - 40, align: 'center' });

  // Signatories — up to two signature blocks (image over a line, name, title/org),
  // laid out along the lower body. Falls back to the single signatory / authority.
  let sigs = (credential.signatories && credential.signatories.length)
    ? credential.signatories
    : [{ name: credential.signatory?.name || 'Authorised Signatory', title: credential.signatory?.title || 'Provincial Manpower Council, KP' }];
  sigs = sigs.slice(0, 2);
  const sigRowY = bodyY + 200;
  const blockW = 165;
  const gap = 40;
  const totalW = sigs.length * blockW + (sigs.length - 1) * gap;
  let sigStartX = cx + Math.max(0, ((cw + 210) - totalW) / 2);
  sigs.forEach((sg, i) => {
    const bx = sigStartX + i * (blockW + gap);
    const buf = loadSignatureBuffer(sg.signatureUrl);
    if (buf) {
      try { doc.image(buf, bx + blockW / 2 - 40, sigRowY - 32, { fit: [80, 30], align: 'center' }); } catch { /* skip bad image */ }
    }
    rule(doc, bx, sigRowY, blockW, SLATE, 0.6);
    doc.fontSize(8).fillColor(NAVY).font('Helvetica-Bold')
      .text(sg.name || '', bx, sigRowY + 4, { width: blockW, align: 'center' });
    doc.fontSize(6.5).fillColor(GREY).font('Helvetica')
      .text([sg.title, sg.org].filter(Boolean).join(', '), bx, sigRowY + 15, { width: blockW, align: 'center' });
  });

  // ── Footer strip ─────────────────────────────────────────────────────────────
  const ftY = H - M - 38;
  doc.rect(M + 7, ftY, W - (M + 7) * 2, 32).fillColor('#F1F5F9').fill();
  rule(doc, M + 7, ftY, W - (M + 7) * 2, GOLD, 1);

  // SHA-256 hash
  if (credential.vc?.credentialHash) {
    doc.fontSize(6.5).fillColor(GREY).font('Helvetica')
      .text(`SHA-256: ${credential.vc.credentialHash}`, M + 14, ftY + 6, { width: (W - M * 2) * 0.6 });
  }
  // Verify URL
  doc.fontSize(7).fillColor(NAVY).font('Helvetica')
    .text(`Verify: ${verifyUrl}`, M + 14, ftY + 18, { width: (W - M * 2) * 0.7 });

  // Issue timestamp
  doc.fontSize(6.5).fillColor(GREY).font('Helvetica')
    .text(`Generated: ${new Date().toISOString()}`, M + 14, ftY + 28, { width: W - M * 2 - 28, align: 'right' });

  doc.end();
}

// ─── Gold wax-seal medallion (vector) ────────────────────────────────────────
function drawSeal(doc, cx, cy, r) {
  doc.save();
  // Ribbon tails
  doc.save();
  doc.fillColor('#9A6B12');
  doc.polygon([cx - 16, cy + r - 6], [cx - 6, cy + r - 6], [cx - 10, cy + r + 34], [cx - 21, cy + r + 26]).fill();
  doc.fillColor('#B8860B');
  doc.polygon([cx + 16, cy + r - 6], [cx + 6, cy + r - 6], [cx + 10, cy + r + 34], [cx + 21, cy + r + 26]).fill();
  doc.restore();
  // Outer gold disc
  doc.circle(cx, cy, r).fillColor(GOLD).fill();
  doc.circle(cx, cy, r).lineWidth(1.4).strokeColor('#8A5E10').stroke();
  // Scalloped/serrated ring
  const teeth = 40;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const x = cx + Math.cos(a) * (r + 3);
    const y = cy + Math.sin(a) * (r + 3);
    doc.circle(x, y, 1.6).fillColor(GOLD).fill();
  }
  // Inner navy disc
  doc.circle(cx, cy, r - 9).fillColor(NAVY).fill();
  doc.circle(cx, cy, r - 9).lineWidth(1).strokeColor('#DFC07A').stroke();
  doc.circle(cx, cy, r - 15).lineWidth(0.5).strokeColor('#DFC07A').stroke();
  // Star burst
  const star = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r - 20 : (r - 20) / 2.4;
    star.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  doc.polygon(...star).fillColor(GOLD).fill();
  // Curved-ish caption
  doc.fontSize(5.5).fillColor('#DFC07A').font('Helvetica-Bold')
    .text('TALENTLEDGER', cx - r + 6, cy - r + 6, { width: (r - 6) * 2, align: 'center' });
  doc.fontSize(5).fillColor('#DFC07A').font('Helvetica')
    .text('VERIFIED', cx - r + 6, cy + r - 16, { width: (r - 6) * 2, align: 'center' });
  doc.restore();
}

// ─── PREMIUM TRAINING-COMPLETION CERTIFICATE (Landscape A4) ──────────────────
// Used for LMS training programmes (e.g. Training of Trainers). Elegant, formal,
// award-style layout distinct from the trade-competency skills card above.
export async function generateTrainingCertificatePDF(credential, stream) {
  const verifyUrl = `${PUBLIC_BASE}/verify/${credential.credentialId}`;
  const qrBuffer = await QRCode.toBuffer(verifyUrl, {
    type: 'png', width: 150, margin: 1, errorCorrectionLevel: 'H', color: { dark: NAVY, light: WHITE },
  });

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 }, info: {
    Title: `Certificate of Completion — ${credential.credentialId}`,
    Author: 'TalentLedger / PPMC KP',
    Subject: credential.programTitle || credential.title || 'Training Completion Certificate',
  }});
  doc.pipe(stream);

  const W = doc.page.width, H = doc.page.height;
  const M = 26;
  const IX = M + 16, IW = W - 2 * (M + 16);

  // Background + watermark
  doc.rect(0, 0, W, H).fillColor('#FBF9F3').fill();
  drawGuilloché(doc, W, H);
  doc.save(); doc.opacity(0.05).fontSize(120).fillColor(NAVY).font('Helvetica-Bold')
    .text('TL', 0, H / 2 - 90, { width: W, align: 'center' }); doc.restore();

  // Side bands + ornate double border
  doc.rect(0, 0, 7, H).fillColor(NAVY).fill();
  doc.rect(W - 7, 0, 7, H).fillColor(NAVY).fill();
  doc.rect(M, M, W - M * 2, H - M * 2).lineWidth(2.5).strokeColor(NAVY).stroke();
  doc.rect(M + 7, M + 7, W - (M + 7) * 2, H - (M + 7) * 2).lineWidth(1).strokeColor(GOLD).stroke();
  // Corner gold diamonds
  [[M + 7, M + 7], [W - M - 7, M + 7], [M + 7, H - M - 7], [W - M - 7, H - M - 7]].forEach(([x, y]) => {
    doc.save(); doc.translate(x, y).rotate(45);
    doc.rect(-4.5, -4.5, 9, 9).fillColor(GOLD).fill(); doc.restore();
  });

  // Partner logos in the top corners at EQUAL height, from credential.logos =
  // [left, right]; falls back to the single PPMC crest placeholder when unset.
  const LOGO_H = 58;
  const logos = Array.isArray(credential.logos) ? credential.logos.map(loadImageBuffer).filter(Boolean) : [];
  if (logos.length) {
    try { doc.image(logos[0], IX, M + 12, { height: LOGO_H }); } catch { /* skip bad image */ }
    if (logos[1]) {
      try {
        let w = 78;
        try { const img = doc.openImage(logos[1]); if (img?.width && img?.height) w = LOGO_H * img.width / img.height; } catch { /* keep default */ }
        doc.image(logos[1], W - IX - w, M + 12, { height: LOGO_H });
      } catch { /* skip */ }
    }
  } else {
    drawLogoBlock(doc, IX, M + 16, 44, 'PPMC\nKP', GOLD);
  }
  // Credential descriptor only (no issuer list).
  doc.fontSize(8).fillColor(GREY).font('Helvetica')
    .text('TalentLedger Skills Passport  ·  Verified Digital Credential', IX + 120, M + 34, { width: IW - 240, align: 'center' });

  // Title
  doc.fontSize(34).fillColor(NAVY).font('Helvetica-Bold')
    .text('CERTIFICATE', IX, M + 62, { width: IW, align: 'center', characterSpacing: 2 });
  doc.fontSize(13).fillColor(GOLD).font('Helvetica-Bold')
    .text('OF COMPLETION', IX, M + 100, { width: IW, align: 'center', characterSpacing: 6 });
  // Flourish rule with centre diamond
  const frY = M + 122;
  rule(doc, W / 2 - 150, frY, 130, GOLD, 1);
  rule(doc, W / 2 + 20, frY, 130, GOLD, 1);
  doc.save(); doc.translate(W / 2, frY).rotate(45); doc.rect(-4, -4, 8, 8).fillColor(GOLD).fill(); doc.restore();

  // Recipient
  doc.fontSize(10.5).fillColor(GREY).font('Helvetica').text('This is to certify that', IX, M + 138, { width: IW, align: 'center' });
  const name = (credential.holderName || credential.worker?.fullName || 'Participant Name');
  doc.fontSize(30).fillColor(SLATE).font('Times-Bold').text(name, IX, M + 154, { width: IW, align: 'center' });
  if (credential.institute && credential.institute !== '—') {
    doc.fontSize(10).fillColor(GREY).font('Helvetica-Oblique').text(credential.institute, IX, M + 190, { width: IW, align: 'center' });
  }
  doc.fontSize(10.5).fillColor(GREY).font('Helvetica')
    .text('has successfully participated in and completed the', IX, M + 208, { width: IW, align: 'center' });
  const prog = credential.programTitle || (credential.title || '').replace(/\s*—\s*Completion Certificate$/i, '');
  doc.fontSize(17).fillColor(NAVY).font('Times-Bold').text(prog, IX + 60, M + 224, { width: IW - 120, align: 'center' });

  // Dates / duration line
  const dateBits = [];
  if (credential.startDate && credential.endDate) dateBits.push(`held from ${fmt(credential.startDate)} to ${fmt(credential.endDate)}`);
  else if (credential.startDate) dateBits.push(`held on ${fmt(credential.startDate)}`);
  if (credential.durationLabel) dateBits.push(credential.durationLabel);
  if (dateBits.length) {
    doc.fontSize(9.5).fillColor(SLATE).font('Helvetica').text(dateBits.join('   ·   '), IX, M + 258, { width: IW, align: 'center' });
  }

  // Result badge
  const passed = (credential.status || 'active') === 'active';
  const badgeText = credential.overallGrade?.letter
    ? `RESULT:  COMPLETED  ·  GRADE ${credential.overallGrade.letter}${credential.overallGrade.score != null ? `  (${credential.overallGrade.score}%)` : ''}`
    : 'RESULT:  SUCCESSFULLY COMPLETED';
  const bw = 320, bx = W / 2 - bw / 2, byy = M + 276;
  doc.roundedRect(bx, byy, bw, 20, 10).fillColor(passed ? '#EAF6EC' : '#FEF2F2').fill();
  doc.roundedRect(bx, byy, bw, 20, 10).lineWidth(0.8).strokeColor(passed ? GREEN : '#B91C1C').stroke();
  doc.fontSize(8.5).fillColor(passed ? GREEN : '#B91C1C').font('Helvetica-Bold').text(badgeText, bx, byy + 6, { width: bw, align: 'center' });

  // ── Lower row: seal (left) · signatures (centre) · QR (right) ──
  const rowY = H - M - 140;
  drawSeal(doc, IX + 58, rowY + 24, 40);

  // QR box (right)
  const qrS = 92, qrX = W - IX - qrS, qrY = rowY - 6;
  doc.roundedRect(qrX, qrY, qrS, qrS, 6).fillColor(WHITE).fill();
  doc.roundedRect(qrX, qrY, qrS, qrS, 6).lineWidth(1).strokeColor(GOLD).stroke();
  doc.image(qrBuffer, qrX + (qrS - 78) / 2, qrY + 7, { width: 78, height: 78 });
  doc.fontSize(6.5).fillColor(GREY).font('Helvetica').text('Scan to verify', qrX, qrY + qrS + 2, { width: qrS, align: 'center' });
  doc.fontSize(7).fillColor(NAVY).font('Helvetica-Bold').text(credential.credentialId, qrX - 20, qrY + qrS + 11, { width: qrS + 40, align: 'center' });

  // Signatories (centre, up to 3)
  let sigs = (credential.signatories && credential.signatories.length)
    ? credential.signatories
    : [{ name: credential.signatory?.name || 'Authorised Signatory', title: credential.signatory?.title || 'TalentLedger, PPMC KP' }];
  sigs = sigs.slice(0, 3);
  const blockW = 150, gap = 26;
  const totalW = sigs.length * blockW + (sigs.length - 1) * gap;
  const centreZoneL = IX + 130, centreZoneR = qrX - 20;
  let startX = centreZoneL + Math.max(0, ((centreZoneR - centreZoneL) - totalW) / 2);
  const sy = rowY + 60;
  sigs.forEach((sg, i) => {
    const sx = startX + i * (blockW + gap);
    const buf = loadSignatureBuffer(sg.signatureUrl);
    if (buf) { try { doc.image(buf, sx + blockW / 2 - 38, sy - 30, { fit: [76, 28], align: 'center' }); } catch { /* skip */ } }
    rule(doc, sx, sy, blockW, SLATE, 0.6);
    doc.fontSize(8.5).fillColor(NAVY).font('Helvetica-Bold').text(sg.name || '', sx, sy + 4, { width: blockW, align: 'center' });
    doc.fontSize(6.5).fillColor(GREY).font('Helvetica').text([sg.title, sg.org].filter(Boolean).join(', '), sx, sy + 15, { width: blockW, align: 'center' });
  });

  // Footer
  const ftY = H - M - 30;
  rule(doc, IX, ftY, IW, GOLD, 0.8);
  doc.fontSize(7).fillColor(NAVY).font('Helvetica').text(`Verify online: ${verifyUrl}`, IX, ftY + 6, { width: IW * 0.7 });
  if (credential.vc?.credentialHash) {
    doc.fontSize(6).fillColor(GREY).font('Helvetica').text(`SHA-256: ${credential.vc.credentialHash}`, IX, ftY + 16, { width: IW * 0.7 });
  }
  doc.fontSize(6.5).fillColor(GREY).font('Helvetica')
    .text(`Issued: ${fmt(credential.validFrom)}${credential.validUntil ? `   ·   Valid until: ${fmt(credential.validUntil)}` : ''}`, IX + IW * 0.5, ftY + 6, { width: IW * 0.5, align: 'right' });

  doc.end();
}


// ─── PVC CARD (CR80: 85.6mm × 54mm @ 300dpi = 1012×638 pts @ 72dpi → 242×153 pts) ──

const MM = 2.8346; // 1mm in PDF points

/** CR80 card dimensions in points */
const CARD_W = Math.round(85.6 * MM); // ≈ 243
const CARD_H = Math.round(54.0 * MM); // ≈ 153

/** Draw guilloché on card (subtle) */
function cardGuilloché(doc) {
  doc.save();
  doc.opacity(0.06);
  doc.lineWidth(0.4).strokeColor(NAVY);
  for (let i = 0; i < 22; i++) {
    const y0 = (CARD_H / 22) * i;
    doc.moveTo(0, y0);
    for (let j = 1; j <= 60; j++) {
      const x = (CARD_W / 60) * j;
      const y = y0 + Math.sin((j / 60) * Math.PI * 4 + i * 0.8) * 2.5;
      doc.lineTo(x, y);
    }
    doc.stroke();
  }
  doc.restore();
}

/** Single info line on card */
function cardRow(doc, lx, vx, y, label, value, lFontSize = 5, vFontSize = 5.5) {
  doc.fontSize(lFontSize).fillColor(GREY).font('Helvetica').text(label, lx, y, { lineBreak: false });
  doc.fontSize(vFontSize).fillColor(SLATE).font('Helvetica-Bold').text(value || '—', vx, y, { lineBreak: false });
}

export async function generateCardPDF(credential, stream) {
  const verifyUrl = `${env.CLIENT_URL || 'https://talentledger.ppmc.org.pk'}/verify/${credential.credentialId}`;

  // QR for card — smaller, Level H
  const qrBuffer = await QRCode.toBuffer(verifyUrl, {
    type: 'png',
    width: 100,
    margin: 1,
    errorCorrectionLevel: 'H',
    color: { dark: NAVY, light: WHITE },
  });

  // Worker photo
  let photoBuffer = null;
  if (credential.worker?.photo) {
    try {
      const photoUrl = credential.worker.photo.startsWith('http')
        ? credential.worker.photo
        : `${env.API_URL || 'http://localhost:5000'}${credential.worker.photo}`;
      photoBuffer = await fetchBuffer(photoUrl);
    } catch { /* skip */ }
  }

  // PDF sized exactly to two CR80 cards side by side (front & back) on one page
  // We place front (left) and back (right) separated by a cut-guide gap
  const GAP = 8;
  const PAGE_W = CARD_W * 2 + GAP + 20;
  const PAGE_H = CARD_H + 30;

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: {
      Title: `TalentLedger PVC Card — ${credential.credentialId}`,
      Author: 'PPMC KP / TalentLedger',
    },
  });
  doc.pipe(stream);

  // ── Page background ──────────────────────────────────────────────────────────
  doc.rect(0, 0, PAGE_W, PAGE_H).fillColor('#D1D5DB').fill();

  // Cut guides (dashed border around each card)
  const frontX = 10;
  const backX  = frontX + CARD_W + GAP;
  const cardY  = 10;

  // Labels above cards
  doc.fontSize(5).fillColor('#374151').font('Helvetica-Bold')
    .text('FRONT', frontX, 2, { width: CARD_W, align: 'center' })
    .text('BACK',  backX,  2, { width: CARD_W, align: 'center' });

  // ════════════════════════════════════════════════════════════════════════════
  // FRONT FACE
  // ════════════════════════════════════════════════════════════════════════════
  const fx = frontX;
  const fy = cardY;

  // Card base
  doc.roundedRect(fx, fy, CARD_W, CARD_H, 4).fillColor(WHITE).fill();
  cardGuilloché(doc);

  // Navy top bar
  const topBarH = 22;
  doc.save();
  doc.roundedRect(fx, fy, CARD_W, topBarH, 4).fillColor(NAVY).fill();
  doc.rect(fx, fy + topBarH - 6, CARD_W, 6).fillColor(NAVY).fill(); // square off bottom
  doc.restore();

  // Gold stripe under top bar
  doc.rect(fx, fy + topBarH, CARD_W, 2).fillColor(GOLD).fill();

  // Header text
  doc.fontSize(5.5).fillColor(WHITE).font('Helvetica-Bold')
    .text('NATIONAL SKILLS PASSPORT', fx + 4, fy + 4, { width: CARD_W - 60, lineBreak: false });
  doc.fontSize(4).fillColor(GOLD)
    .text('ہنر پاسپورٹ', fx + 4, fy + 12, { width: CARD_W - 60, lineBreak: false });

  // Small logo box top-right
  doc.roundedRect(fx + CARD_W - 26, fy + 2, 22, 18, 2).fillColor(GOLD).fill();
  doc.fontSize(4).fillColor(NAVY).font('Helvetica-Bold')
    .text('PPMC\nKP', fx + CARD_W - 26, fy + 5, { width: 22, align: 'center' });

  // Photo area
  const phX = fx + 5;
  const phY = fy + topBarH + 5;
  const phW = 30;
  const phH = 38;
  doc.rect(phX, phY, phW, phH).fillColor(LGREY).fill();
  if (photoBuffer) {
    doc.image(photoBuffer, phX, phY, { width: phW, height: phH, cover: [phW, phH] });
  } else {
    doc.fontSize(4).fillColor(GREY).font('Helvetica')
      .text('PHOTO', phX, phY + phH / 2 - 2, { width: phW, align: 'center' });
  }
  doc.rect(phX, phY, phW, phH).lineWidth(0.5).strokeColor(GOLD).stroke();

  // Info area next to photo
  const infoX = phX + phW + 5;
  const infoY = phY;
  const infoW = CARD_W - infoX - 40; // leave space for QR

  // Worker name
  const shortName = (credential.worker?.fullName || 'WORKER NAME').toUpperCase();
  doc.fontSize(6.5).fillColor(SLATE).font('Helvetica-Bold')
    .text(shortName, infoX, infoY, { width: infoW, lineBreak: false });

  cardRow(doc, infoX, infoX + 22, infoY + 10, 'S/O:', credential.worker?.fatherName || '—');
  cardRow(doc, infoX, infoX + 22, infoY + 18, 'CNIC:', credential.worker?.cnicMasked || '****-*******-*');
  cardRow(doc, infoX, infoX + 22, infoY + 26, 'Trade:', cap(credential.trade));

  // NQF + EQF pill
  doc.roundedRect(infoX, infoY + 34, 28, 8, 2).fillColor(NAVY).fill();
  doc.fontSize(4.5).fillColor(GOLD).font('Helvetica-Bold')
    .text(`NQF ${credential.nqfLevel || 2}  |  EQF ${credential.nqfLevel || 2}`, infoX + 1, infoY + 36, { width: 26, align: 'center', lineBreak: false });

  // Reg number
  cardRow(doc, infoX, infoX + 22, infoY + 46, 'Reg:', credential.worker?.registrationId || '—');

  // QR on front (right side)
  const qrSize = 36;
  const qrX = fx + CARD_W - qrSize - 4;
  const qrY = fy + topBarH + 4;
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.fontSize(3.5).fillColor(GREY).font('Helvetica')
    .text('Scan to verify', qrX, qrY + qrSize + 1, { width: qrSize, align: 'center', lineBreak: false });

  // Credential ID bottom
  const credIdY = fy + CARD_H - 14;
  doc.rect(fx, credIdY, CARD_W, 14).fillColor('#F1F5F9').fill();
  doc.rect(fx, credIdY, CARD_W, 0.5).fillColor(GOLD).fill();
  doc.fontSize(5).fillColor(NAVY).font('Helvetica-Bold')
    .text(credential.credentialId, fx + 4, credIdY + 4, { width: CARD_W * 0.5, lineBreak: false });

  // Blockchain short ref
  const txHash = credential.blockchain?.txHash;
  if (txHash) {
    const short = `${txHash.slice(0, 8)}...${txHash.slice(-4)}`;
    doc.fontSize(4).fillColor(GREEN).font('Helvetica')
      .text(`⛓ ${short}`, fx + CARD_W * 0.52, credIdY + 3, { width: CARD_W * 0.44, align: 'right', lineBreak: false });
    doc.fontSize(3.5).fillColor(GREY)
      .text('Polygon PoS', fx + CARD_W * 0.52, credIdY + 9, { width: CARD_W * 0.44, align: 'right', lineBreak: false });
  } else {
    doc.fontSize(4).fillColor(GREY).font('Helvetica')
      .text('Blockchain: Pending', fx + CARD_W * 0.52, credIdY + 5, { width: CARD_W * 0.44, align: 'right', lineBreak: false });
  }

  // Card border
  doc.roundedRect(fx, fy, CARD_W, CARD_H, 4).lineWidth(0.5).strokeColor('#9CA3AF').stroke();

  // ════════════════════════════════════════════════════════════════════════════
  // BACK FACE
  // ════════════════════════════════════════════════════════════════════════════
  const bx = backX;
  const by = cardY;

  doc.roundedRect(bx, by, CARD_W, CARD_H, 4).fillColor(WHITE).fill();

  // Top strip
  doc.save();
  doc.roundedRect(bx, by, CARD_W, 14, 4).fillColor(NAVY).fill();
  doc.rect(bx, by + 8, CARD_W, 6).fillColor(NAVY).fill();
  doc.restore();
  doc.rect(bx, by + 14, CARD_W, 1.5).fillColor(GOLD).fill();
  doc.fontSize(5).fillColor(WHITE).font('Helvetica-Bold')
    .text('COMPETENCY RECORD', bx + 4, by + 4, { width: CARD_W * 0.6, lineBreak: false });
  doc.fontSize(4).fillColor(GOLD)
    .text('Valid: ' + fmt(credential.validFrom) + ' – ' + fmt(credential.validUntil), bx + CARD_W * 0.55, by + 5, { width: CARD_W * 0.42, align: 'right', lineBreak: false });

  // Competency units list
  const units = credential.competencyUnits || [];
  const unitStartY = by + 18;
  const unitH = 8;
  const maxUnits = 6;
  const displayUnits = units.slice(0, maxUnits);

  if (displayUnits.length > 0) {
    displayUnits.forEach((unit, i) => {
      const uy = unitStartY + i * unitH;
      const isCompetent = unit.status === 'competent';
      doc.circle(bx + 7, uy + 3, 2.5).fillColor(isCompetent ? '#22C55E' : LGREY).fill();
      doc.fontSize(4.5).fillColor(SLATE).font('Helvetica-Bold')
        .text(unit.unitCode || `CU-${i + 1}`, bx + 12, uy + 1, { lineBreak: false });
      doc.fontSize(4).fillColor(GREY).font('Helvetica')
        .text(unit.unitTitle || '—', bx + 38, uy + 1, { width: CARD_W * 0.5, lineBreak: false });
      const lvl = unit.nqfLevel || credential.nqfLevel || '—';
      doc.fontSize(4).fillColor(NAVY).font('Helvetica-Bold')
        .text(`L${lvl}`, bx + CARD_W - 18, uy + 1, { lineBreak: false });
    });
  } else {
    // No units — show trade info
    doc.fontSize(5).fillColor(GREY).font('Helvetica')
      .text(`Trade: ${cap(credential.trade)}`, bx + 6, unitStartY + 4);
    doc.fontSize(5).fillColor(GREY)
      .text(`Assessed By: ${credential.institution || 'PPMC Peshawar'}`, bx + 6, unitStartY + 14);
    doc.fontSize(5)
      .text(`ISCO-08: ${credential.iscoCode || '—'}`, bx + 6, unitStartY + 24);
  }

  // Separator line
  const sepY = by + CARD_H - 30;
  doc.rect(bx + 4, sepY, CARD_W - 8, 0.5).fillColor(LGREY).fill();

  // Bottom row: verify text + barcode-style placeholder
  doc.fontSize(4).fillColor(GREY).font('Helvetica')
    .text('Report loss / verify:', bx + 4, sepY + 4, { lineBreak: false });
  doc.fontSize(4).fillColor(NAVY).font('Helvetica-Bold')
    .text(verifyUrl, bx + 4, sepY + 10, { width: CARD_W - 8, lineBreak: false });

  // Barcode-style lines (visual only — Code-128 would need a library)
  const bcX = bx + 4;
  const bcY2 = sepY + 19;
  doc.fontSize(4.5).fillColor('#111').font('Helvetica-Bold')
    .text('|||  ' + credential.credentialId + '  |||', bcX, bcY2, { width: CARD_W - 8, align: 'center', lineBreak: false });

  // Card border
  doc.roundedRect(bx, by, CARD_W, CARD_H, 4).lineWidth(0.5).strokeColor('#9CA3AF').stroke();

  // Footer label below cards
  doc.fontSize(5).fillColor('#374151').font('Helvetica')
    .text('CR80 Standard (85.6 × 54 mm) — Print at 300 DPI on PVC card stock', 0, cardY + CARD_H + 6, { width: PAGE_W, align: 'center' });

  doc.end();
}
