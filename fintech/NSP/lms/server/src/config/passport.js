import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import Worker from '../models/Worker.js';
import Counter from '../models/Counter.js';
import env from './env.js';

/**
 * Google OAuth 2.0 Strategy
 * Flow: /api/auth/google → Google consent → /api/auth/google/callback
 *       → create/find user → redirect to client with JWT
 */
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL || `${env.CLIENT_URL.replace('5173', '5000')}/api/auth/google/callback`,
      scope: ['profile', 'email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        if (!email) return done(new Error('No email from Google profile'), null);

        // 1. Try to find existing user by googleId
        let user = await User.findOne({ googleId: profile.id });

        // 2. Try to find by email (link accounts)
        if (!user) {
          user = await User.findOne({ email });
          if (user) {
            // Link Google account to existing user
            user.googleId = profile.id;
            user.oauthProvider = user.oauthProvider || 'google';
            if (!user.avatar && profile.photos?.[0]?.value) {
              user.avatar = profile.photos[0].value;
            }
            // Auto-verify email for OAuth users
            if (!user.emailVerified) {
              user.emailVerified = true;
            }
            await user.save();
            return done(null, user);
          }
        }

        // 3. Create new user
        if (!user) {
          const name = profile.displayName ||
            `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() ||
            email.split('@')[0];

          // Generate a secure random password (never used — OAuth only)
          const { randomBytes } = await import('crypto');
          const oauthPassword = randomBytes(32).toString('hex') + 'Aa1!';

          user = await User.create({
            name,
            email,
            password: oauthPassword,
            role: 'worker',
            googleId: profile.id,
            oauthProvider: 'google',
            avatar: profile.photos?.[0]?.value || undefined,
            emailVerified: true, // Google already verified the email
            termsAcceptedAt: new Date(),
            termsVersion: '1.0',
          });

          // Auto-create worker profile
          try {
            const seq = await Counter.getNextSequence('worker');
            const regId = `TL-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
            await Worker.create({
              user: user._id,
              fullName: name,
              registrationId: regId,
              cnicEncrypted: 'N/A',
              cnicMasked: 'N/A',
              district: 'Not specified',
              trade: 'mason',
            });
          } catch (workerErr) {
            console.error('[OAuth] Worker auto-create failed:', workerErr.message);
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  ));
} else {
  console.info('[Passport] Google OAuth disabled (GOOGLE_CLIENT_ID not set)');
}

// Minimal session serialization (we use JWT, not sessions — but passport requires these)
passport.serializeUser((user, done) => done(null, user._id.toString()));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

export default passport;
