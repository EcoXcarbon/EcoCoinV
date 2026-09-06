import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

/**
 * Handles the Google OAuth redirect.
 * The server redirects here with the JWT in the URL fragment:
 *   /auth/callback#token=<JWT>
 *
 * Using a fragment (not query string) keeps the token out of
 * server logs, browser history, and HTTP Referer headers.
 */
export default function OAuthCallback() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const fragment = window.location.hash.slice(1); // strip leading #
    const params = new URLSearchParams(fragment);
    const token = params.get('token');
    const error = params.get('error');

    // Clear fragment from URL immediately (security hygiene)
    window.history.replaceState(null, '', window.location.pathname);

    if (error) {
      toast.error('Google sign-in failed. Please try again.');
      navigate('/login', { replace: true });
      return;
    }

    if (!token) {
      toast.error('Authentication failed: no token received.');
      navigate('/login', { replace: true });
      return;
    }

    loginWithToken(token)
      .then(() => {
        toast.success('Signed in with Google');
        navigate('/', { replace: true });
      })
      .catch(() => {
        toast.error('Could not verify your session. Please sign in again.');
        navigate('/login', { replace: true });
      });
  }, [loginWithToken, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ilo-dark via-ilo-blue to-ilo-dark">
      <div className="text-center text-white space-y-4">
        <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-medium opacity-80">Completing sign-in…</p>
      </div>
    </div>
  );
}
