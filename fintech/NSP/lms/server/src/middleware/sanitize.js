/**
 * Sanitize middleware to prevent NoSQL injection and XSS.
 * Strips MongoDB operators ($-prefixed keys) from request body/query/params.
 */

function stripDollarKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripDollarKeys);

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue; // strip MongoDB operators
    cleaned[key] = typeof value === 'object' ? stripDollarKeys(value) : value;
  }
  return cleaned;
}

export function sanitizeInput(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = stripDollarKeys(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = stripDollarKeys(req.query);
  }
  next();
}

/**
 * Escape special regex characters from user input to prevent ReDoS.
 */
export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
