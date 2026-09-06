import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { BadgeDefinition, LearnerProfile } from '../models/Achievement.js';
import Worker from '../models/Worker.js';
import Training from '../models/Training.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { generateOB3Badge } from '../services/badgeService.js';

const router = Router();

/* ═══════════════════════════════════════════════════════════
   BADGE DEFINITIONS
   ═══════════════════════════════════════════════════════════ */

// Get all badge definitions
router.get('/badges', authenticate, async (req, res, next) => {
  try {
    const badges = await BadgeDefinition.find().sort('category code');
    res.json(badges);
  } catch (err) { next(err); }
});

// Create badge definition (admin)
router.post('/badges', authenticate, authorize('admin'), [
  body('code').trim().notEmpty().isLength({ max: 50 }),
  body('title').trim().notEmpty().isLength({ max: 100 }),
  body('description').optional().trim().isLength({ max: 500 }),
  body('category').isIn(['learning', 'quiz', 'streak', 'social', 'completion', 'special']),
  body('xpReward').optional().isInt({ min: 1, max: 1000 }).toInt(),
  body('rarity').optional().isIn(['common', 'uncommon', 'rare', 'epic', 'legendary']),
  handleValidation,
], async (req, res, next) => {
  try {
    const badge = await BadgeDefinition.create(req.body);
    res.status(201).json(badge);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   LEARNER PROFILE & GAMIFICATION
   ═══════════════════════════════════════════════════════════ */

// Get my learner profile (or create if not exists)
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'worker') return res.json(null);
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.json(null);

    let profile = await LearnerProfile.findOne({ worker: worker._id })
      .populate('badges.badge')
      .populate('recommendedCourses.training', 'title trade thumbnail difficulty');

    if (!profile) {
      profile = await LearnerProfile.create({ worker: worker._id });
    }

    res.json(profile);
  } catch (err) { next(err); }
});

// Award XP and check badge eligibility
router.post('/award-xp', authenticate, [
  body('workerId').optional().isMongoId(),
  body('xp').isInt({ min: 1, max: 500 }).toInt(),
  body('reason').trim().notEmpty().isLength({ max: 200 }),
  handleValidation,
], async (req, res, next) => {
  try {
    let workerId = req.body.workerId;
    if (req.user.role === 'worker' && !workerId) {
      const w = await Worker.findOne({ user: req.user._id }).select('_id');
      if (w) workerId = w._id.toString();
    }
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });
    const { xp, reason } = req.body;

    let profile = await LearnerProfile.findOne({ worker: workerId });
    if (!profile) {
      profile = await LearnerProfile.create({ worker: workerId });
    }

    const oldLevel = profile.level;
    profile.xp += xp;
    profile.calculateLevel();

    const result = { xpAwarded: xp, totalXp: profile.xp, level: profile.level, newBadges: [], leveledUp: false };

    if (profile.level > oldLevel) {
      result.leveledUp = true;
    }

    // Check badge eligibility based on reason
    const badgesToCheck = await BadgeDefinition.find();
    for (const badge of badgesToCheck) {
      if (profile.badges.some(b => b.badgeCode === badge.code)) continue; // Already earned

      let earned = false;
      const ct = badge.criteria?.type;
      const th = badge.criteria?.threshold || 0;

      if (ct === 'xp-total' && profile.xp >= th) earned = true;
      if (ct === 'level' && profile.level >= th) earned = true;
      if (ct === 'streak' && profile.currentStreak >= th) earned = true;
      if (ct === 'courses-completed' && profile.analytics.totalCoursesCompleted >= th) earned = true;
      if (ct === 'modules-completed' && profile.analytics.totalModulesCompleted >= th) earned = true;
      if (ct === 'quizzes-passed' && profile.analytics.totalQuizzesPassed >= th) earned = true;
      if (ct === 'quiz-score' && profile.analytics.avgQuizScore >= th) earned = true;
      if (ct === 'certificates' && profile.analytics.totalCertificates >= th) earned = true;

      if (earned) {
        // Gap 2: Generate OB3 JWT for the earned badge
        let ob3jwt = null;
        try {
          const workerDoc = await Worker.findById(workerId).select('fullName registrationId trade');
          if (workerDoc) {
            const ob3 = generateOB3Badge(badge, workerDoc, new Date());
            ob3jwt = ob3.jwt;
          }
        } catch { /* OB3 generation is non-blocking */ }

        profile.badges.push({ badge: badge._id, badgeCode: badge.code, ob3jwt });
        profile.xp += badge.xpReward || 0;
        result.newBadges.push({ code: badge.code, title: badge.title, xpReward: badge.xpReward });
      }
    }

    profile.calculateLevel();
    await profile.save();

    result.totalXp = profile.xp;
    result.level = profile.level;
    res.json(result);
  } catch (err) { next(err); }
});

// Update streak
router.put('/streak', authenticate, [
  body('workerId').optional().isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    let workerId = req.body.workerId;
    if (req.user.role === 'worker' && !workerId) {
      const w = await Worker.findOne({ user: req.user._id }).select('_id');
      if (w) workerId = w._id.toString();
    }
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });
    let profile = await LearnerProfile.findOne({ worker: workerId });
    if (!profile) {
      profile = await LearnerProfile.create({ worker: workerId });
    }

    const today = new Date().toISOString().split('T')[0];
    const lastActive = profile.lastActiveDate
      ? profile.lastActiveDate.toISOString().split('T')[0]
      : null;

    if (lastActive !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      if (lastActive === yesterday) {
        profile.currentStreak += 1;
      } else if (lastActive !== today) {
        profile.currentStreak = 1;
      }
      if (profile.currentStreak > profile.longestStreak) {
        profile.longestStreak = profile.currentStreak;
      }
    }
    profile.lastActiveDate = new Date();
    await profile.save();

    res.json({
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
    });
  } catch (err) { next(err); }
});

// Update competency scores
router.put('/competency', authenticate, [
  body('workerId').optional().isMongoId(),
  body('skill').trim().notEmpty(),
  body('score').isInt({ min: 0, max: 100 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    let workerId = req.body.workerId;
    if (req.user.role === 'worker' && !workerId) {
      const w = await Worker.findOne({ user: req.user._id }).select('_id');
      if (w) workerId = w._id.toString();
    }
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });
    const { skill, score } = req.body;
    let profile = await LearnerProfile.findOne({ worker: workerId });
    if (!profile) {
      profile = await LearnerProfile.create({ worker: workerId });
    }

    const existing = profile.competencies.find(c => c.skill === skill);
    if (existing) {
      // Weighted average of assessments
      const newTotal = existing.assessments + 1;
      existing.score = Math.round((existing.score * existing.assessments + score) / newTotal);
      existing.assessments = newTotal;
      existing.lastAssessedAt = new Date();

      // Auto-level based on score
      if (existing.score >= 90) existing.level = 'expert';
      else if (existing.score >= 75) existing.level = 'advanced';
      else if (existing.score >= 55) existing.level = 'intermediate';
      else if (existing.score >= 30) existing.level = 'foundation';
      else existing.level = 'novice';
    } else {
      let level = 'novice';
      if (score >= 90) level = 'expert';
      else if (score >= 75) level = 'advanced';
      else if (score >= 55) level = 'intermediate';
      else if (score >= 30) level = 'foundation';

      profile.competencies.push({ skill, level, score, assessments: 1, lastAssessedAt: new Date() });
    }

    await profile.save();
    res.json(profile.competencies);
  } catch (err) { next(err); }
});

// Log weekly activity
router.put('/activity', authenticate, [
  body('workerId').optional().isMongoId(),
  body('minutesSpent').isInt({ min: 1, max: 600 }).toInt(),
  body('modulesCompleted').optional().isInt({ min: 0 }).toInt(),
  body('quizzesTaken').optional().isInt({ min: 0 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    let workerId = req.body.workerId;
    if (req.user.role === 'worker' && !workerId) {
      const w = await Worker.findOne({ user: req.user._id }).select('_id');
      if (w) workerId = w._id.toString();
    }
    if (!workerId) return res.status(400).json({ error: 'workerId is required' });
    const { minutesSpent, modulesCompleted = 0, quizzesTaken = 0 } = req.body;
    let profile = await LearnerProfile.findOne({ worker: workerId });
    if (!profile) profile = await LearnerProfile.create({ worker: workerId });

    // Get current ISO week
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((now - jan1) / 86400000) + jan1.getDay() + 1) / 7);
    const weekKey = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

    const existing = profile.analytics.weeklyActivity.find(w => w.week === weekKey);
    if (existing) {
      existing.minutesSpent += minutesSpent;
      existing.modulesCompleted += modulesCompleted;
      existing.quizzesTaken += quizzesTaken;
    } else {
      profile.analytics.weeklyActivity.push({ week: weekKey, minutesSpent, modulesCompleted, quizzesTaken });
      // Keep only last 12 weeks
      if (profile.analytics.weeklyActivity.length > 12) {
        profile.analytics.weeklyActivity = profile.analytics.weeklyActivity.slice(-12);
      }
    }

    profile.analytics.totalTimeSpentMinutes += minutesSpent;
    profile.analytics.totalModulesCompleted += modulesCompleted;

    profile.calculateEngagement();
    profile.calculateDropoutRisk();
    await profile.save();

    res.json({
      engagementScore: profile.analytics.engagementScore,
      dropoutRisk: profile.analytics.dropoutRisk,
      weeklyActivity: profile.analytics.weeklyActivity.slice(-4),
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   LEADERBOARD
   ═══════════════════════════════════════════════════════════ */
router.get('/leaderboard', authenticate, [
  query('limit').optional().isInt({ min: 5, max: 50 }).toInt(),
  query('trade').optional().isLength({ max: 50 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const limit = req.query.limit || 20;

    let workerFilter = {};
    if (req.query.trade) {
      const workers = await Worker.find({ trade: req.query.trade }).select('_id');
      workerFilter = { worker: { $in: workers.map(w => w._id) } };
    }

    const profiles = await LearnerProfile.find(workerFilter)
      .sort({ xp: -1 })
      .limit(limit)
      .populate('worker', 'fullName trade district');

    const leaderboard = profiles.map((p, idx) => ({
      rank: idx + 1,
      worker: {
        _id: p.worker?._id,
        name: p.worker?.fullName,
        trade: p.worker?.trade,
        district: p.worker?.district,
      },
      xp: p.xp,
      level: p.level,
      badgeCount: p.badges.length,
      currentStreak: p.currentStreak,
      coursesCompleted: p.analytics.totalCoursesCompleted,
      engagementScore: p.analytics.engagementScore,
    }));

    res.json(leaderboard);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   RECOMMENDATIONS (collaborative filtering + content-based)
   ═══════════════════════════════════════════════════════════ */
router.get('/recommendations', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'worker') return res.json([]);
    const worker = await Worker.findOne({ user: req.user._id }).select('_id trade nqfLevel');
    if (!worker) return res.json([]);

    const profile = await LearnerProfile.findOne({ worker: worker._id });

    // Get all enrolled course IDs for this worker
    const enrolledPrograms = await Training.find({ 'enrollments.worker': worker._id }).select('_id trade');
    const enrolledIds = enrolledPrograms.map(p => p._id.toString());

    // Strategy 1: Same trade, not enrolled
    const tradeCourses = await Training.find({
      trade: worker.trade,
      status: 'active',
      _id: { $nin: enrolledIds },
    }).select('title trade nqfLevel difficulty thumbnail ratings enrollments modules duration').limit(5);

    // Strategy 2: Courses popular with similar workers (collaborative filtering)
    const similarWorkers = await Worker.find({
      trade: worker.trade,
      _id: { $ne: worker._id },
    }).select('_id').limit(20);
    const similarWorkerIds = similarWorkers.map(w => w._id);

    const popularAmongPeers = await Training.find({
      'enrollments.worker': { $in: similarWorkerIds },
      _id: { $nin: enrolledIds },
      status: 'active',
    }).select('title trade nqfLevel difficulty thumbnail ratings enrollments modules duration').limit(5);

    // Strategy 3: Based on weak competencies
    let weakSkillCourses = [];
    if (profile?.competencies?.length > 0) {
      const weakSkills = profile.competencies
        .filter(c => c.score < 60)
        .map(c => c.skill);

      if (weakSkills.length > 0) {
        weakSkillCourses = await Training.find({
          'modules.competencies.skill': { $in: weakSkills },
          _id: { $nin: enrolledIds },
          status: 'active',
        }).select('title trade nqfLevel difficulty thumbnail ratings enrollments modules duration').limit(3);
      }
    }

    // Strategy 4: Next NQF level courses
    const nqfCourses = await Training.find({
      trade: worker.trade,
      nqfLevel: { $gt: worker.nqfLevel || 1 },
      status: 'active',
      _id: { $nin: enrolledIds },
    }).select('title trade nqfLevel difficulty thumbnail ratings enrollments modules duration').limit(3);

    // Combine and deduplicate
    const seen = new Set();
    const recommendations = [];

    const addRecs = (courses, reason) => {
      for (const c of courses) {
        if (seen.has(c._id.toString())) continue;
        seen.add(c._id.toString());
        recommendations.push({
          _id: c._id,
          title: c.title,
          trade: c.trade,
          nqfLevel: c.nqfLevel,
          difficulty: c.difficulty,
          thumbnail: c.thumbnail,
          avgRating: c.avgRating,
          enrollmentCount: c.enrollments?.length || 0,
          moduleCount: c.modules?.length || 0,
          duration: c.duration,
          reason,
        });
      }
    };

    addRecs(weakSkillCourses, 'Strengthen weak skills');
    addRecs(tradeCourses, 'Matches your trade');
    addRecs(popularAmongPeers, 'Popular with similar workers');
    addRecs(nqfCourses, 'Advance to next NQF level');

    res.json(recommendations.slice(0, 10));
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   SMART NUDGES — check who needs a nudge
   ═══════════════════════════════════════════════════════════ */
router.get('/nudges', authenticate, authorize('admin', 'institution', 'worker'), async (req, res, next) => {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    // Workers only see their own nudge; admin/institution see all
    const filter = { lastActiveDate: { $lt: threeDaysAgo }, 'notifications.nudgesEnabled': true };
    if (req.user.role === 'worker') {
      const workerDoc = await (await import('../models/Worker.js')).default.findOne({ user: req.user._id }).select('_id');
      if (!workerDoc) return res.json([]);
      filter.worker = workerDoc._id;
    }

    const inactiveProfiles = await LearnerProfile.find(filter).populate('worker', 'fullName trade');

    const nudges = inactiveProfiles.map(p => {
      const daysSinceActive = p.lastActiveDate
        ? Math.floor((Date.now() - p.lastActiveDate.getTime()) / 86400000)
        : 99;

      return {
        worker: { _id: p.worker?._id, name: p.worker?.fullName, trade: p.worker?.trade },
        daysSinceActive,
        dropoutRisk: p.analytics.dropoutRisk,
        engagementScore: p.analytics.engagementScore,
        currentStreak: p.currentStreak,
        suggestedNudge: daysSinceActive > 7
          ? `We miss you! Your ${p.longestStreak}-day streak is waiting to be beaten.`
          : `You're ${daysSinceActive} days away from your learning. Pick up where you left off!`,
      };
    });

    nudges.sort((a, b) => b.dropoutRisk - a.dropoutRisk);
    res.json(nudges);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   GAP 2: OPEN BADGES 3.0 ENDPOINTS
   ═══════════════════════════════════════════════════════════ */

// Get OB3 JSON-LD for a specific earned badge
router.get('/badges/:badgeCode/ob3', authenticate, async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const profile = await LearnerProfile.findOne({ worker: worker._id });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const earnedBadge = profile.badges.find(b => b.badgeCode === req.params.badgeCode);
    if (!earnedBadge) return res.status(404).json({ error: 'Badge not earned' });

    if (!earnedBadge.ob3jwt) {
      return res.status(404).json({ error: 'OB3 credential not available for this badge' });
    }

    // Decode JWT to return JSON-LD
    const parts = earnedBadge.ob3jwt.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      res.setHeader('Content-Type', 'application/ld+json');
      return res.json(payload.vc || payload);
    }

    res.type('text/plain').send(earnedBadge.ob3jwt);
  } catch (err) { next(err); }
});

// Get all earned badges as OB3 array
router.get('/profile/ob3', authenticate, async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id');
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const profile = await LearnerProfile.findOne({ worker: worker._id }).populate('badges.badge');
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const ob3Badges = [];
    for (const b of profile.badges) {
      if (!b.ob3jwt) continue;
      try {
        const parts = b.ob3jwt.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        ob3Badges.push({
          badgeCode: b.badgeCode,
          title: b.badge?.title,
          earnedAt: b.earnedAt,
          ob3: payload.vc || payload,
          jwt: b.ob3jwt,
        });
      } catch { /* skip malformed JWTs */ }
    }

    res.json(ob3Badges);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   CONTENT STALENESS REPORT
   ═══════════════════════════════════════════════════════════ */
router.get('/content-staleness', authenticate, authorize('admin', 'institution'), async (req, res, next) => {
  try {
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000);

    const programs = await Training.find({ status: 'active' })
      .select('title trade modules lastReviewedAt contentVersion');

    const report = [];
    for (const p of programs) {
      const staleModules = p.modules.filter(m =>
        !m.lastReviewedAt || m.lastReviewedAt < sixMonthsAgo || m.flaggedStale
      );

      if (staleModules.length > 0 || !p.lastReviewedAt || p.lastReviewedAt < sixMonthsAgo) {
        report.push({
          _id: p._id,
          title: p.title,
          trade: p.trade,
          contentVersion: p.contentVersion,
          lastReviewedAt: p.lastReviewedAt,
          totalModules: p.modules.length,
          staleModules: staleModules.map(m => ({
            _id: m._id,
            title: m.title,
            type: m.type,
            lastReviewedAt: m.lastReviewedAt,
            flaggedStale: m.flaggedStale,
            stalenessNotes: m.stalenessNotes,
          })),
        });
      }
    }

    report.sort((a, b) => b.staleModules.length - a.staleModules.length);
    res.json(report);
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   ADVANCED LEARNER ANALYTICS
   ═══════════════════════════════════════════════════════════ */
router.get('/learner-analytics', authenticate, authorize('admin', 'institution', 'assessor'), [
  query('trade').optional().isLength({ max: 50 }),
  handleValidation,
], async (req, res, next) => {
  try {
    let workerFilter = {};
    if (req.query.trade) {
      const workers = await Worker.find({ trade: req.query.trade }).select('_id');
      workerFilter = { worker: { $in: workers.map(w => w._id) } };
    }

    const profiles = await LearnerProfile.find(workerFilter)
      .populate('worker', 'fullName trade district');

    // Aggregate analytics
    const totalProfiles = profiles.length;
    let totalXp = 0, totalEngagement = 0, totalDropoutRisk = 0;
    let highRisk = 0, medRisk = 0, lowRisk = 0;
    const competencyAgg = {};

    for (const p of profiles) {
      totalXp += p.xp;
      totalEngagement += p.analytics.engagementScore;
      totalDropoutRisk += p.analytics.dropoutRisk;

      if (p.analytics.dropoutRisk > 60) highRisk++;
      else if (p.analytics.dropoutRisk > 30) medRisk++;
      else lowRisk++;

      for (const c of p.competencies) {
        if (!competencyAgg[c.skill]) competencyAgg[c.skill] = { total: 0, count: 0 };
        competencyAgg[c.skill].total += c.score;
        competencyAgg[c.skill].count += 1;
      }
    }

    const competencyOverview = Object.entries(competencyAgg).map(([skill, data]) => ({
      skill,
      avgScore: Math.round(data.total / data.count),
      assessments: data.count,
    })).sort((a, b) => a.avgScore - b.avgScore);

    res.json({
      summary: {
        totalLearners: totalProfiles,
        avgXp: totalProfiles ? Math.round(totalXp / totalProfiles) : 0,
        avgEngagement: totalProfiles ? Math.round(totalEngagement / totalProfiles) : 0,
        avgDropoutRisk: totalProfiles ? Math.round(totalDropoutRisk / totalProfiles) : 0,
      },
      riskDistribution: { highRisk, medRisk, lowRisk },
      competencyOverview,
      atRiskLearners: profiles
        .filter(p => p.analytics.dropoutRisk > 50)
        .map(p => ({
          worker: { _id: p.worker?._id, name: p.worker?.fullName, trade: p.worker?.trade },
          dropoutRisk: p.analytics.dropoutRisk,
          engagementScore: p.analytics.engagementScore,
          daysSinceActive: p.lastActiveDate
            ? Math.floor((Date.now() - p.lastActiveDate.getTime()) / 86400000)
            : 99,
        }))
        .sort((a, b) => b.dropoutRisk - a.dropoutRisk)
        .slice(0, 20),
    });
  } catch (err) { next(err); }
});

/* ═══════════════════════════════════════════════════════════
   OPEN BADGES 3.0 ENDPOINTS
   ═══════════════════════════════════════════════════════════ */

// Get OB3 JSON-LD for a specific earned badge
router.get('/badges/:badgeCode/ob3', authenticate, async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id fullName registrationId email trade');
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const profile = await LearnerProfile.findOne({ worker: worker._id }).populate('badges.badge');
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const earned = profile.badges.find(b => b.badgeCode === req.params.badgeCode);
    if (!earned) return res.status(404).json({ error: 'Badge not earned' });

    // Return existing OB3 JWT decoded, or generate fresh
    if (earned.ob3jwt) {
      try {
        const parts = earned.ob3jwt.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        res.setHeader('Content-Type', 'application/ld+json');
        return res.json(payload.vc || payload);
      } catch { /* fall through to regenerate */ }
    }

    const badgeDef = earned.badge || await BadgeDefinition.findOne({ code: req.params.badgeCode });
    if (!badgeDef) return res.status(404).json({ error: 'Badge definition not found' });

    const ob3 = generateOB3Badge(badgeDef, worker, earned.earnedAt);
    earned.ob3jwt = ob3.jwt;
    await profile.save();

    res.setHeader('Content-Type', 'application/ld+json');
    res.json(ob3.jsonLd);
  } catch (err) { next(err); }
});

// Export all earned badges as OB3 JSON-LD array
router.get('/profile/ob3', authenticate, async (req, res, next) => {
  try {
    const worker = await Worker.findOne({ user: req.user._id }).select('_id fullName registrationId email trade');
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const profile = await LearnerProfile.findOne({ worker: worker._id }).populate('badges.badge');
    if (!profile) return res.json([]);

    const ob3Badges = [];
    let needsSave = false;
    for (const earned of profile.badges) {
      const badgeDef = earned.badge || await BadgeDefinition.findOne({ code: earned.badgeCode });
      if (!badgeDef) continue;

      if (earned.ob3jwt) {
        try {
          const parts = earned.ob3jwt.split('.');
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          ob3Badges.push(payload.vc || payload);
          continue;
        } catch { /* regenerate below */ }
      }

      const ob3 = generateOB3Badge(badgeDef, worker, earned.earnedAt);
      earned.ob3jwt = ob3.jwt;
      needsSave = true;
      ob3Badges.push(ob3.jsonLd);
    }

    if (needsSave) await profile.save();
    res.setHeader('Content-Type', 'application/ld+json');
    res.json(ob3Badges);
  } catch (err) { next(err); }
});

export default router;
