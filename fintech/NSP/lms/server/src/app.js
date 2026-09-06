import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { uploadAuth } from './middleware/uploadAuth.js';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import env from './config/env.js';
import passport from './config/passport.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { csrfTokenRoute, csrfProtection } from './middleware/csrf.js';
import { healthCheck } from './middleware/apiGateway.js';
import { authenticate } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import mfaRoutes from './routes/mfa.js';
import workerRoutes from './routes/workers.js';
import credentialRoutes from './routes/credentials.js';
import assessmentRoutes from './routes/assessments.js';
import trainingRoutes from './routes/training.js';
import caseStudyRoutes from './routes/caseStudies.js';
import examRoutes from './routes/exam.js';
import examAdminRoutes from './routes/examAdmin.js';
import courseAdminRoutes from './routes/courseAdmin.js';
import analyticsRoutes from './routes/analytics.js';
import verificationRoutes from './routes/verification.js';
import reportRoutes from './routes/reports.js';
import pathwayRoutes from './routes/pathways.js';
import achievementRoutes from './routes/achievements.js';
import aiRoutes from './routes/ai.js';
import tracerStudyRoutes from './routes/tracerStudies.js';
import xapiRoutes from './routes/xapi.js';
import scormRoutes from './routes/scorm.js';
import jobRoutes from './routes/jobs.js';
import documentRoutes from './routes/documents.js';
import notificationRoutes from './routes/notifications.js';
import assessorRoutes from './routes/assessors.js';
import venueRoutes from './routes/venues.js';
import employerSatisfactionRoutes from './routes/employerSatisfaction.js';
import registryRoutes from './routes/registry.js';
import walletRoutes, { publicShareRouter } from './routes/wallet.js';
import wellKnownRoutes from './routes/wellKnown.js';
import publicSurveyRouter from './routes/publicSurvey.js';
import companyRoutes from './routes/companies.js';
import classroomRoutes from './routes/classes.js';
import classStreamRoutes from './routes/classStream.js';
import classAssignmentRoutes from './routes/classAssignments.js';
import classUploadRoutes from './routes/classUploads.js';
import classTopicRoutes from './routes/classTopics.js';
import classLiveRoutes from './routes/classLive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Trust nginx reverse proxy (required for rate limiting behind proxy)
app.set('trust proxy', 1);

// Disable ETags on dynamic responses. Authenticated JSON must never be
// HTTP-cached: when two identical GETs fire (e.g. the LMS catalog and the
// staff Training manager both request /training), the second was returning a
// 304 Not Modified with an empty body — which axios rejects (304 ∉ 2xx),
// silently emptying the list ("No trainings found."). express.static keeps its
// own ETag handling, so uploaded-file caching is unaffected.
app.set('etag', false);

// Security headers
app.use(helmet({
  contentSecurityPolicy: env.isProd ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

// CORS — restrict to known origin
app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
}));

// Global rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProd ? 10000 : 10000,   // raised: exam class behind one NAT IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

// Stricter rate limiter for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProd ? 2000 : 2000,   // raised: whole class logs in behind one campus NAT IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

// Body parsing — reduced limits
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// NoSQL injection prevention — strip $-prefixed keys
app.use(sanitizeInput);

// Passport (OAuth strategies — session: false, we use JWT)
app.use(passport.initialize());

// Public share access (no auth, no CSRF — must be before CSRF middleware)
app.use(publicShareRouter);

// Public survey (no auth, no CSRF — direct-link field-visit feedback)
app.use('/api/v1/public-survey', publicSurveyRouter);

// /.well-known/* — DID Configuration, OpenID4VCI, JWKS (no auth, no CSRF)
app.use('/.well-known', wellKnownRoutes);

// CSRF protection — double-submit cookie pattern
app.get('/api/csrf-token', csrfTokenRoute);
app.get('/api/v1/csrf-token', csrfTokenRoute);
app.use('/api', csrfProtection);

// Authenticated API JSON must not be HTTP-cached (prevents stale reads and the
// 304-empty-body race described above). Applies to /api only; the /api/uploads
// static handler below sets its own long-lived caching afterwards.
app.use('/api', (req, res, next) => {
  if (!req.path.startsWith('/uploads')) res.set('Cache-Control', 'no-store');
  next();
});

// Serve uploads ONLY with authentication
app.use('/uploads', authenticate, express.static(path.join(__dirname, '../uploads'), {
  dotfiles: 'deny',
  index: false,
  setHeaders(res) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'attachment');
  },
}));

// Authenticated downloads under /api/* so the session cookie (path=/api) is sent
// by plain <a href> links from a logged-in browser. Accepts Bearer OR refresh cookie.
app.use('/api/uploads', uploadAuth, express.static(path.join(__dirname, '../uploads'), {
  dotfiles: 'deny',
  index: false,
  setHeaders(res) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'attachment');
  },
}));

// API v1 routes (versioned)
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/auth/mfa', authLimiter, mfaRoutes);
app.use('/api/v1/workers', workerRoutes);
app.use('/api/v1/credentials', credentialRoutes);
app.use('/api/v1/assessments', assessmentRoutes);
app.use('/api/v1/training', trainingRoutes);
app.use('/api/v1/cases', caseStudyRoutes);
app.use('/api/v1/exam', examRoutes);
app.use('/course-materials', express.static(path.join(__dirname, '../uploads/course-materials')));
app.use('/api/v1/exam-admin', examAdminRoutes);
app.use('/api/v1/courses', courseAdminRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/verification', verificationRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/pathways', pathwayRoutes);
app.use('/api/v1/achievements', achievementRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/tracer-studies', tracerStudyRoutes);
app.use('/api/v1/xapi', xapiRoutes);
app.use('/api/v1/scorm', scormRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/assessors', assessorRoutes);
app.use('/api/v1/venues', venueRoutes);
app.use('/api/v1/employer-satisfaction', employerSatisfactionRoutes);
app.use('/api/v1/registry', registryRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/companies', companyRoutes);
app.use('/api/v1/classroom', classroomRoutes);
app.use('/api/v1/classroom/:classId/stream', classStreamRoutes);
app.use('/api/v1/classroom/:classId/classwork', classAssignmentRoutes);
app.use('/api/v1/classroom/:classId/uploads', classUploadRoutes);
app.use('/api/v1/classroom/:classId/topics', classTopicRoutes);
app.use('/api/v1/classroom/:classId/live', classLiveRoutes);

// Backward-compatible unversioned routes (alias to v1)
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/auth/mfa', authLimiter, mfaRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/credentials', credentialRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/cases', caseStudyRoutes);
app.use('/api/exam', examRoutes);
app.use('/api/exam-admin', examAdminRoutes);
app.use('/api/courses', courseAdminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/pathways', pathwayRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/tracer-studies', tracerStudyRoutes);
app.use('/api/xapi', xapiRoutes);
app.use('/api/scorm', scormRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/assessors', assessorRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/employer-satisfaction', employerSatisfactionRoutes);
app.use('/api/registry', registryRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/classroom', classroomRoutes);
app.use('/api/classroom/:classId/stream', classStreamRoutes);
app.use('/api/classroom/:classId/classwork', classAssignmentRoutes);
app.use('/api/classroom/:classId/uploads', classUploadRoutes);
app.use('/api/classroom/:classId/topics', classTopicRoutes);
app.use('/api/classroom/:classId/live', classLiveRoutes);

// Health check — returns services status, uptime, version
app.get('/api/health', healthCheck);

// Global error handler
app.use((err, req, res, _next) => {
  const status = err.status || 500;

  // Log full error server-side
  console.error(`[ERROR] ${req.method} ${req.originalUrl} — ${err.message}`);
  if (!env.isProd) console.error(err.stack);

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map(e => ({ field: e.path, message: e.message }));
    return res.status(400).json({ error: 'Validation failed', details });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(409).json({ error: `Duplicate value for ${field}` });
  }

  res.status(status).json({
    error: env.isProd ? 'Internal server error' : err.message,
  });
});

export default app;
