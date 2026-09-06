import axios from 'axios';

const api = axios.create({
  baseURL: '/lms/api',
  withCredentials: true,
});

// CSRF token cache
let csrfToken = null;

// Shared in-flight refresh promise so concurrent 401s trigger only ONE refresh
// (a rotating refresh-token cookie consumed by a race would log the user out).
let refreshPromise = null;

function getCsrfFromCookie() {
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function mintCsrfToken() {
  const { data } = await axios.get('/lms/api/csrf-token', { withCredentials: true });
  csrfToken = data.csrfToken;
  return csrfToken;
}

// The COOKIE is what the server double-submits against, and it expires on its
// own clock. Caching the token in memory meant that once the cookie lapsed we
// kept echoing a header with no cookie behind it — every /auth/refresh came
// back 403 "CSRF token missing" and the user was bounced to /login mid-session.
// Always re-read the cookie; mint a new pair only when it is genuinely gone.
async function ensureCsrfToken() {
  const fromCookie = getCsrfFromCookie();
  if (fromCookie) {
    csrfToken = fromCookie;
    return csrfToken;
  }
  return mintCsrfToken();
}

// /auth/refresh is cookie-authenticated (no Bearer), so the CSRF middleware
// requires the double-submit header. A stale cookie is recoverable: mint a
// fresh pair and try once more before giving up on the session.
async function requestRefresh() {
  const send = async () => {
    const csrf = await ensureCsrfToken();
    return axios.post('/lms/api/auth/refresh', {}, {
      withCredentials: true,
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
    });
  };
  try {
    const { data } = await send();
    return data.accessToken;
  } catch (err) {
    if (err.response?.status === 403) {
      await mintCsrfToken();
      const { data } = await send();
      return data.accessToken;
    }
    throw err;
  }
}

// Attach access token + CSRF token
api.interceptors.request.use(async config => {
  const token = localStorage.getItem('tl-token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Add CSRF token for state-changing requests
  if (['post', 'put', 'delete', 'patch'].includes(config.method)) {
    const csrf = await ensureCsrfToken();
    if (csrf) config.headers['X-CSRF-Token'] = csrf;
  }
  return config;
});

// Auto-refresh on 401, retry CSRF on 403
api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;

    // CSRF token expired — refresh and retry once
    if (err.response?.status === 403 && err.response?.data?.error?.includes('CSRF') && !original._csrfRetry) {
      original._csrfRetry = true;
      csrfToken = null;
      const csrf = await ensureCsrfToken();
      original.headers['X-CSRF-Token'] = csrf;
      return api(original);
    }

    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = requestRefresh().finally(() => { refreshPromise = null; });
        }
        const accessToken = await refreshPromise;
        localStorage.setItem('tl-token', accessToken);
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (refreshErr) {
        // Only a genuine auth failure ends the session. A dropped campus wifi or
        // a server hiccup must not wipe the token and bounce a student out of
        // the case they are part-way through — the next request retries.
        const status = refreshErr.response?.status;
        if (status === 401 || status === 403) {
          localStorage.removeItem('tl-token');
          window.location.href = '/login';
        }
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(err);
  }
);

export default api;
