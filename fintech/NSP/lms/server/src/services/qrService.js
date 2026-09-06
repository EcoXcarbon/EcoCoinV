import QRCode from 'qrcode';

export async function generateQR(data, opts = {}) {
  return QRCode.toDataURL(data, {
    width: opts.width || 200,
    margin: opts.margin ?? 2,
    color: { dark: opts.dark || '#002D72', light: opts.light || '#FFFFFF' },
    errorCorrectionLevel: opts.errorCorrectionLevel || 'H', // High — survives scratches
  });
}

/** Generate QR as raw PNG Buffer (for embedding in PDFs, HTTP response) */
export async function generateQRBuffer(data, opts = {}) {
  return QRCode.toBuffer(data, {
    type: 'png',
    width: opts.width || 200,
    margin: opts.margin ?? 1,
    color: { dark: opts.dark || '#002D72', light: opts.light || '#FFFFFF' },
    errorCorrectionLevel: opts.errorCorrectionLevel || 'H',
  });
}
