import mongoose from 'mongoose';

/* ═══════════════════════════════════════════════════════════
   ACHIEVEMENT & GAMIFICATION MODEL
   Badges, XP, streaks, leaderboards
   ═══════════════════════════════════════════════════════════ */

// Badge definitions (system-wide)
const badgeDefinitionSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },    // e.g., 'first-quiz', 'streak-7'
  title: { type: String, required: true },
  description: { type: String },
  icon: { type: String, default: 'trophy' },               // icon name
  category: {
    type: String,
    enum: ['learning', 'quiz', 'streak', 'social', 'completion', 'special'],
    default: 'learning',
  },
  xpReward: { type: Number, default: 10 },
  criteria: {
    type: { type: String },    // 'course-complete', 'quiz-score', 'streak', 'modules-done', etc.
    threshold: { type: Number },
    metadata: mongoose.Schema.Types.Mixed,
  },
  rarity: { type: String, enum: ['common', 'uncommon', 'rare', 'epic', 'legendary'], default: 'common' },
}, { timestamps: true });

// Per-worker gamification profile
const learnerProfileSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true, unique: true },
  // XP & Level
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },

  // Badges earned
  badges: [{
    badge: { type: mongoose.Schema.Types.ObjectId, ref: 'BadgeDefinition' },
    badgeCode: { type: String },
    earnedAt: { type: Date, default: Date.now },
    ob3jwt: { type: String },  // Gap 2: Open Badges 3.0 signed JWT
  }],

  // Streaks
  currentStreak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  lastActiveDate: { type: Date },

  // Competency map: skill → level with scores
  competencies: [{
    skill: { type: String, required: true },
    level: { type: String, enum: ['novice', 'foundation', 'intermediate', 'advanced', 'expert'], default: 'novice' },
    score: { type: Number, default: 0, min: 0, max: 100 },
    assessments: { type: Number, default: 0 },             // times assessed
    lastAssessedAt: { type: Date },
  }],

  // Learning analytics
  analytics: {
    totalCoursesCompleted: { type: Number, default: 0 },
    totalModulesCompleted: { type: Number, default: 0 },
    totalQuizzesPassed: { type: Number, default: 0 },
    totalQuizzesFailed: { type: Number, default: 0 },
    avgQuizScore: { type: Number, default: 0 },
    totalTimeSpentMinutes: { type: Number, default: 0 },
    totalCertificates: { type: Number, default: 0 },

    // Per-week activity (last 12 weeks)
    weeklyActivity: [{
      week: { type: String },     // '2026-W08'
      minutesSpent: { type: Number, default: 0 },
      modulesCompleted: { type: Number, default: 0 },
      quizzesTaken: { type: Number, default: 0 },
    }],

    // Module time tracking
    moduleTimeLog: [{
      moduleId: { type: mongoose.Schema.Types.ObjectId },
      trainingId: { type: mongoose.Schema.Types.ObjectId },
      startedAt: { type: Date },
      completedAt: { type: Date },
      timeSpentMinutes: { type: Number },
    }],

    // Engagement score (0-100, computed)
    engagementScore: { type: Number, default: 50 },

    // Dropout risk (0-100, computed)
    dropoutRisk: { type: Number, default: 0 },
  },

  // Smart notification preferences
  notifications: {
    nudgesEnabled: { type: Boolean, default: true },
    lastNudgeSent: { type: Date },
    inactiveDaysBeforeNudge: { type: Number, default: 3 },
  },

  // Recommendations cache
  recommendedCourses: [{
    training: { type: mongoose.Schema.Types.ObjectId, ref: 'Training' },
    reason: { type: String },
    score: { type: Number },
    recommendedAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

// worker already has unique: true which creates an index
learnerProfileSchema.index({ xp: -1 });     // For leaderboard
learnerProfileSchema.index({ 'analytics.engagementScore': -1 });

// XP to level calculation
learnerProfileSchema.methods.calculateLevel = function () {
  // Level = floor(sqrt(xp / 100)) + 1
  this.level = Math.floor(Math.sqrt(this.xp / 100)) + 1;
  return this.level;
};

// Engagement score calculation
learnerProfileSchema.methods.calculateEngagement = function () {
  const a = this.analytics;
  const recentWeeks = (a.weeklyActivity || []).slice(-4);
  if (recentWeeks.length === 0) { a.engagementScore = 0; return; }

  const avgMinutes = recentWeeks.reduce((s, w) => s + w.minutesSpent, 0) / recentWeeks.length;
  const avgModules = recentWeeks.reduce((s, w) => s + w.modulesCompleted, 0) / recentWeeks.length;
  const streakBonus = Math.min(this.currentStreak * 2, 20);

  // Score: frequency (40%) + depth (30%) + streak (20%) + quiz performance (10%)
  const frequencyScore = Math.min(avgMinutes / 60 * 40, 40);  // 1hr/week = full marks
  const depthScore = Math.min(avgModules / 3 * 30, 30);       // 3 modules/week = full marks
  const quizScore = a.avgQuizScore ? (a.avgQuizScore / 100 * 10) : 5;

  a.engagementScore = Math.round(Math.min(frequencyScore + depthScore + streakBonus + quizScore, 100));
};

// Dropout risk calculation
learnerProfileSchema.methods.calculateDropoutRisk = function () {
  const a = this.analytics;
  let risk = 0;

  // Days since last active
  if (this.lastActiveDate) {
    const daysSince = (Date.now() - this.lastActiveDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) risk += 40;
    else if (daysSince > 7) risk += 25;
    else if (daysSince > 3) risk += 10;
  } else {
    risk += 50;
  }

  // Declining activity
  const recentWeeks = (a.weeklyActivity || []).slice(-4);
  if (recentWeeks.length >= 2) {
    const recent = recentWeeks[recentWeeks.length - 1]?.minutesSpent || 0;
    const prev = recentWeeks[recentWeeks.length - 2]?.minutesSpent || 1;
    if (recent < prev * 0.5) risk += 20;
  }

  // Low quiz scores
  if (a.avgQuizScore > 0 && a.avgQuizScore < 50) risk += 15;

  // Low engagement
  if (a.engagementScore < 20) risk += 15;

  // Broken streak
  if (this.longestStreak > 5 && this.currentStreak === 0) risk += 10;

  a.dropoutRisk = Math.min(risk, 100);
};

const BadgeDefinition = mongoose.model('BadgeDefinition', badgeDefinitionSchema);
const LearnerProfile = mongoose.model('LearnerProfile', learnerProfileSchema);

export { BadgeDefinition, LearnerProfile };
