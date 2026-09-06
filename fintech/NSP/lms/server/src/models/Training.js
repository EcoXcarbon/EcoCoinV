import mongoose from 'mongoose';

// Competency tag schema — maps modules/quizzes to specific skills
const competencyTagSchema = new mongoose.Schema({
  skill: { type: String, required: true },           // e.g., "Electrical Safety", "Load Calculation"
  level: { type: String, enum: ['foundation', 'intermediate', 'advanced', 'expert'], default: 'foundation' },
  weight: { type: Number, default: 1, min: 0.1, max: 5 },  // How much this module contributes to skill
}, { _id: false });

// Scenario choice/branch for scenario-based modules
const scenarioStepSchema = new mongoose.Schema({
  stepId: { type: String, required: true },
  narrative: { type: String, required: true },       // Situation description
  image: { type: String },
  choices: [{
    text: { type: String, required: true },
    nextStepId: { type: String },                    // null = end
    isOptimal: { type: Boolean, default: false },
    feedback: { type: String },
    scoreImpact: { type: Number, default: 0 },       // + or - points
  }],
}, { _id: false });

const moduleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  type: { type: String, enum: ['video', 'reading', 'quiz', 'practical', 'assignment', 'scenario', 'scorm'], default: 'video' },
  duration: { type: Number },                      // minutes
  videoUrl: { type: String },
  order: { type: Number },
  // Journey markers for the unified Training tab. A `quiz` module flagged
  // isPreAssessment is the diagnostic pre-test; isFinalAssessment is the graded
  // post-test that gates certificate issuance.
  isPreAssessment: { type: Boolean, default: false },
  isFinalAssessment: { type: Boolean, default: false },
  // ── Graded online-exam metadata (IMSciences assessment system) ──
  examType:  { type: String, enum: ['pre', 'mid', 'final', 'quiz', 'assignment', null], default: null }, // category for gradebook grouping
  examPassword: { type: String, default: '' },                 // exam access password; empty = open. Never sent to students.
  // Exam sections (from "Section:"/"Overview:" lines in the uploaded bank):
  // tag matches quizQuestions[].competencyTag; overview is shown when the section starts.
  sections: [{ tag: String, overview: String }],
  weightPct: { type: Number, default: 0, min: 0, max: 100 },   // contribution to the course final grade
  opensAt:   { type: Date },                                    // schedule window (optional)
  closesAt:  { type: Date },
  // A single pre/post instrument: the SAME question set is taken as a blind
  // Pre-test (baseline) and again as the Post-test, to measure learning gain.
  isPrePost: { type: Boolean, default: false },
  // A reading module flagged isTrainerAssessment renders the interactive
  // trainer-rating survey (submits to /trainer-assessment) instead of static text.
  isTrainerAssessment: { type: Boolean, default: false },
  // A reading module flagged isSurvey renders an interactive survey activity
  // (single/multi choice + free text) that participants submit once.
  isSurvey: { type: Boolean, default: false },
  // When true, the survey can also be filled via a public direct link
  // (no login) at /s/:trainingId/:moduleId — used for field-visit feedback.
  publicSurvey: { type: Boolean, default: false },
  surveyQuestions: [{
    section: { type: String },                     // optional group heading
    prompt: { type: String },
    options: [{ type: String }],                   // for choice questions
    multi: { type: Boolean, default: false },      // tick more than one
    text: { type: Boolean, default: false },       // free-text answer instead of options
  }],
  content: { type: String },                       // Rich text/markdown content for reading modules
  attachments: [{ name: String, url: String, size: Number }],

  // Quiz questions with difficulty tags for adaptive selection (Gap 6: multi-type support)
  quizQuestions: [{
    question: String,
    type: { type: String, enum: ['mcq', 'true-false', 'fill-blank', 'matching', 'ordering', 'drag-drop', 'short-answer', 'essay', 'hotspot'], default: 'mcq' },
    // MCQ fields (backward compatible)
    options: [String],
    correctOption: Number,
    // True/False
    correctAnswer: { type: String },
    // Fill-in-blank / Short answer
    acceptableAnswers: [String],
    caseSensitive: { type: Boolean, default: false },
    // Matching
    matchPairs: [{ left: String, right: String }],
    // Ordering
    correctOrder: [String],
    // Drag-drop
    dropZones: [{ id: String, label: String, accepts: [String] }],
    draggables: [{ id: String, text: String, correctZone: String }],
    // Hotspot
    hotspotImage: { type: String },
    hotspotRegions: [{ x: Number, y: Number, width: Number, height: Number, label: String, correct: Boolean }],
    // Essay / answer-box (written) — graded by the AI relay against these
    essayRubric: { type: String },
    modelAnswer: { type: String },       // reference answer the relay grades against
    scoringCriteria: { type: String },   // what a good answer must contain
    wordLimit: { type: Number },         // suggested word count for a written answer (e.g. 200)
    // Common
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    competencyTag: { type: String },
    explanation: { type: String },
    points: { type: Number, default: 1 },
  }],

  // Pre-check questions for module skip-testing
  preCheckQuestions: [{
    question: String,
    options: [String],
    correctOption: Number,
  }],

  // Scenario-based module data (branching decision trees)
  scenario: {
    steps: [scenarioStepSchema],
    startStepId: { type: String },
    passingScore: { type: Number, default: 60 },
    maxScore: { type: Number, default: 100 },
  },

  // Competency mapping — what skills does this module teach/assess?
  competencies: [competencyTagSchema],

  // Content freshness tracking
  lastReviewedAt: { type: Date },
  contentVersion: { type: Number, default: 1 },
  flaggedStale: { type: Boolean, default: false },
  stalenessNotes: { type: String },

  deadline: { type: Date },                        // Optional deadline for module completion

  // ─── Rubric-based assessment for practical/assignment modules ───
  rubricTemplate: [{
    criterion: { type: String, required: true },
    description: { type: String },
    maxScore: { type: Number, default: 4, min: 1, max: 10 },
    weightPct: { type: Number, default: 20, min: 0, max: 100 },   // percentage weight of the criterion
  }],
  rubricRequired: { type: Boolean, default: false },

  // ─── Knowledge checks for video/reading modules ───
  knowledgeChecks: [{
    question: { type: String, required: true },
    type: { type: String, enum: ['mcq', 'true-false', 'fill-blank'], default: 'mcq' },
    options: [String],
    correctOption: { type: Number },
    correctAnswer: { type: String },
    acceptableAnswers: [String],
    caseSensitive: { type: Boolean, default: false },
    competencyTag: { type: String },
    explanation: { type: String },
  }],
  knowledgeCheckRequired: { type: Boolean, default: false },
  knowledgeCheckPassMark: { type: Number, default: 70, min: 0, max: 100 },

  // SCORM support (Gap 4)
  scormVersion: { type: String, enum: ['1.2', '2004', null], default: null },
  scormManifest: { type: mongoose.Schema.Types.Mixed },
  scormLaunchFile: { type: String },
  scormData: { type: Map, of: mongoose.Schema.Types.Mixed },
}, { _id: true });

// L11: Quiz attempt tracking — persists scores to DB
const quizAttemptSchema = new mongoose.Schema({
  moduleId: { type: mongoose.Schema.Types.ObjectId, required: true },
  score: { type: Number, min: 0, max: 100, required: true },
  correctAnswers: { type: Number, required: true },
  totalQuestions: { type: Number, required: true },
  passed: { type: Boolean, required: true },
  phase: { type: String },   // 'pre' | 'post' for a pre/post instrument (undefined for plain quizzes)
  answers: [{
    questionIndex: Number,
    selectedOption: Number,
    correctOption: Number,
    correctAnswer: String,
    response: String,
    explanation: String,
    aiFeedback: String,
    type: { type: String },   // wrapped so mongoose treats `type` as a field, not a type descriptor
    partialScore: Number,
    isCorrect: Boolean,
  }],
  attemptedAt: { type: Date, default: Date.now },
}, { _id: true });

// L19: Notification for training events
const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  type: {
    type: String,
    enum: [
      'enrollment', 'module-complete', 'quiz-passed', 'quiz-failed', 'course-complete',
      'certificate-issued', 'announcement', 'discussion-reply',
      // Smart nudges
      'nudge-inactive', 'nudge-streak', 'nudge-milestone', 'nudge-recommendation',
      'nudge-peer-progress', 'badge-earned', 'level-up', 'pathway-progress',
      'submission-reviewed',
    ],
    required: true,
  },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

// Discussion post schema for course-level discussions
const discussionSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
  authorRole: { type: String },
  moduleId: { type: mongoose.Schema.Types.ObjectId },  // optional: tie to specific module
  message: { type: String, required: true, maxlength: 2000 },
  pinned: { type: Boolean, default: false },
  replies: [{
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String },
    message: { type: String, required: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

// Announcements from instructors/admins
const announcementSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
  title: { type: String, required: true, maxlength: 200 },
  message: { type: String, required: true, maxlength: 3000 },
  priority: { type: String, enum: ['normal', 'important', 'urgent'], default: 'normal' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

// Course rating/review
const ratingSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  workerName: { type: String },
  score: { type: Number, min: 1, max: 5, required: true },
  review: { type: String, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

// Assignment submission for practical/assignment modules
const submissionSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  moduleId: { type: mongoose.Schema.Types.ObjectId, required: true },
  files: [{ name: String, url: String, size: Number }],
  notes: { type: String, maxlength: 1000 },
  evidenceType: { type: String, enum: ['photo-of-work', 'video-demonstration', 'supervisor-signoff', 'other'], default: 'other' },
  status: { type: String, enum: ['submitted', 'reviewed', 'approved', 'rejected'], default: 'submitted' },
  feedback: { type: String, maxlength: 1000 },
  grade: { type: Number, min: 0, max: 100 },
  submittedAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // ─── Rubric-based scoring ───
  rubricScores: [{
    criterion: { type: String, required: true },
    score: { type: Number, min: 0, max: 10, required: true },
    notes: { type: String },
  }],
  rubricTotal: { type: Number },
  rubricMaxTotal: { type: Number },
  rubricPercentage: { type: Number },

  // ─── Self-assessment by worker ───
  selfAssessment: [{
    criterion: { type: String, required: true },
    score: { type: Number, min: 0, max: 10, required: true },
    notes: { type: String },
  }],

  // AI-suggested grade (instructor reviews before accepting)
  aiGrade: {
    suggestedScore: Number,
    strengths: [String],
    weaknesses: [String],
    feedback: String,
    generatedAt: Date,
  },
}, { _id: true });

const enrollmentSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  enrolledAt: { type: Date, default: Date.now },
  // ─── Self-enrolment details captured at the public /join gate ───
  contact: { type: String, maxlength: 60 },      // phone / WhatsApp
  institute: { type: String, maxlength: 200 },   // organisation / institution / district
  progress: { type: Number, default: 0, min: 0, max: 100 },
  completedModules: [mongoose.Schema.Types.ObjectId],
  skippedViaPreCheck: [mongoose.Schema.Types.ObjectId],
  modulePreChecks: [{
    moduleId: mongoose.Schema.Types.ObjectId,
    score: Number,
    passed: Boolean,
    takenAt: { type: Date, default: Date.now },
  }],
  moduleCredentials: [{
    moduleId: mongoose.Schema.Types.ObjectId,
    credentialId: String,
    title: String,
    issuedAt: { type: Date, default: Date.now },
  }],
  quizAttempts: [quizAttemptSchema],
  submissions: [submissionSchema],
  bookmarked: { type: Boolean, default: false },
  lastAccessedAt: { type: Date, default: Date.now },
  lastModuleId: { type: mongoose.Schema.Types.ObjectId },  // Resume where left off
  status: { type: String, enum: ['enrolled', 'in-progress', 'completed', 'submitted', 'evaluated', 'dropped'], default: 'enrolled' },
  completedAt: { type: Date },
  certificateIssued: { type: Boolean, default: false },
  certificateId: { type: String },

  // Competency scores earned in this course (aggregated from quizzes/scenarios)
  competencyScores: [{
    skill: { type: String },
    score: { type: Number, default: 0 },
    assessments: { type: Number, default: 0 },
  }],

  // Time tracking per module
  moduleTimeLog: [{
    moduleId: { type: mongoose.Schema.Types.ObjectId },
    startedAt: { type: Date },
    completedAt: { type: Date },
    timeSpentMinutes: { type: Number, default: 0 },
  }],
  totalTimeSpentMinutes: { type: Number, default: 0 },

  // Adaptive quiz: track difficulty performance to adjust next quiz
  adaptiveData: {
    quizDifficultyLevel: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    consecutiveCorrect: { type: Number, default: 0 },
    consecutiveWrong: { type: Number, default: 0 },
  },

  // AI-generated adaptive learning path
  adaptivePath: {
    suggestedOrder: [{ moduleId: { type: mongoose.Schema.Types.ObjectId }, reason: String }],
    recommendations: [String],
    weakAreas: [{ skill: String, suggestion: String }],
    generatedAt: { type: Date },
  },

  // Evaluation & transcript fields
  evaluationGrade: { type: Number, min: 0, max: 100 },
  evaluationSummary: {
    overallGrade: String,  // A, B, C, D, F
    strengths: [String],
    weaknesses: [String],
    recommendation: String,
    evaluatedAt: Date,
    evaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  // ─── Weighted grading breakdown ───
  gradingBreakdown: {
    quizRawScore: { type: Number },
    practicalRawScore: { type: Number },
    scenarioRawScore: { type: Number },
    participationRawScore: { type: Number },
    quizWeightedScore: { type: Number },
    practicalWeightedScore: { type: Number },
    scenarioWeightedScore: { type: Number },
    participationWeightedScore: { type: Number },
    effectiveWeights: {
      quiz: { type: Number },
      practical: { type: Number },
      scenario: { type: Number },
      participation: { type: Number },
    },
    calculatedGrade: { type: Number },
    calculatedAt: { type: Date },
  },

  // ─── Competency gap report ───
  competencyGapReport: [{
    skill: { type: String },
    targetLevel: { type: String },
    currentScore: { type: Number },
    threshold: { type: Number },
    met: { type: Boolean },
    gap: { type: Number },
  }],
  competencyCheckPassed: { type: Boolean },

  // ─── Certificate letter grades (per-domain + overall) ───
  // e.g. [{ domain: 'Greening', score: 88, letter: 'A' }, { domain: 'Skills', score: 76, letter: 'B+' }]
  certificateGrades: [{ domain: String, score: Number, letter: String }],
  overallGrade: { letter: String, score: Number },

  // ─── Knowledge check attempts for video/reading modules ───
  knowledgeCheckAttempts: [{
    moduleId: { type: mongoose.Schema.Types.ObjectId, required: true },
    score: { type: Number, required: true },
    correctAnswers: { type: Number, required: true },
    totalQuestions: { type: Number, required: true },
    passed: { type: Boolean, required: true },
    attemptedAt: { type: Date, default: Date.now },
  }],

  preAssessmentScore: { type: Number, min: 0, max: 100 },
  preAssessmentData: {
    questions: [{
      question: String,
      userAnswer: String,
      correct: Boolean,
      explanation: String
    }],
    knownTopics: [String],
    focusAreas: [String],
    takenAt: Date
  },

  // Scenario results
  scenarioResults: [{
    moduleId: { type: mongoose.Schema.Types.ObjectId },
    score: { type: Number },
    maxScore: { type: Number },
    passed: { type: Boolean },
    choicesMade: [{ stepId: String, choiceIndex: Number }],
    completedAt: { type: Date, default: Date.now },
  }],

  // Scored interactive-exercise submissions (single attempt, no retry)
  exerciseResults: [{
    practiceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    score: { type: Number, required: true },       // 0-100 %
    response: { type: String },                    // the trainee's written reply
    feedback: { type: String },                    // AI overall comment
    wrong: [String],                               // AI comments on what's wrong/missing
    correctAnswers: { type: Number },
    totalQuestions: { type: Number },
    perQuestion: [{ questionIndex: Number, isCorrect: Boolean, score: Number, explanation: String, correctText: String, response: String, aiFeedback: String, type: { type: String } }],
    submittedAt: { type: Date, default: Date.now },
  }],
}, { _id: true });

// ─── Interactive Exercises (Practice) ───
// Ungraded drill questions with instant feedback + explanations and unlimited
// retries. Kept OUT of `modules` so they never affect progress %, weighted
// grading, or certificate gating — practice is purely for reinforcement.
// Mirrors the module quizQuestions shape so QuizRenderer/scoreQuestion work as-is.
const questionFields = {
  question: String,
  type: { type: String, enum: ['mcq', 'true-false', 'fill-blank', 'matching', 'ordering', 'drag-drop', 'short-answer', 'essay', 'hotspot'], default: 'mcq' },
  options: [String],
  correctOption: Number,
  correctAnswer: { type: String },
  acceptableAnswers: [String],
  caseSensitive: { type: Boolean, default: false },
  matchPairs: [{ left: String, right: String }],
  correctOrder: [String],
  dropZones: [{ id: String, label: String, accepts: [String] }],
  draggables: [{ id: String, text: String, correctZone: String }],
  hotspotImage: { type: String },
  hotspotRegions: [{ x: Number, y: Number, width: Number, height: Number, label: String, correct: Boolean }],
  essayRubric: { type: String },
  modelAnswer: { type: String },
  scoringCriteria: { type: String },
  wordLimit: { type: Number },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  competencyTag: { type: String },
  explanation: { type: String },
  points: { type: Number, default: 1 },
};
const practiceQuestionSchema = new mongoose.Schema(questionFields, { _id: false });
// Question Bank items carry an _id so they can be referenced/assembled individually.
const bankQuestionSchema = new mongoose.Schema(questionFields, { _id: true });

const practiceSetSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  order: { type: Number, default: 0 },
  content: { type: String },           // the exercise itself, shown to trainees
  scoringCriteria: { type: String },   // how the AI should grade the written reply
  questions: [practiceQuestionSchema], // legacy (older MCQ-style exercises)
}, { _id: true });

const trainingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  trade: { type: String, required: true },
  nqfLevel: { type: Number, min: 1, max: 8 },
  instructor: { type: String },
  institution: { type: String },
  duration: { type: String },                      // "12 Weeks"
  thumbnail: { type: String },
  modules: [moduleSchema],
  practiceSets: [practiceSetSchema],           // Interactive Exercises — ungraded drills
  // ─── Material Library — uploaded, downloadable course resources ───
  resources: [{
    name: { type: String, required: true },
    url: { type: String, required: true },     // served at /api/uploads/<file>
    size: { type: Number },
    mimetype: { type: String },
    category: { type: String, default: 'general' },  // handout, slides, reference, video, template…
    uploadedAt: { type: Date, default: Date.now },
  }],
  // ─── Question Bank — reusable pooled questions; assemble into exam modules ───
  questionBank: [bankQuestionSchema],
  enrollments: [enrollmentSchema],
  notifications: [notificationSchema],
  discussions: [discussionSchema],
  announcements: [announcementSchema],
  ratings: [ratingSchema],
  prerequisites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Training' }],
  maxEnrollment: { type: Number, default: 50 },
  openEnrollment: { type: Boolean, default: false },   // allow public Gmail self-enrolment via /join/:id
  // Course materials (handouts/slides) for the IMSciences assessment system
  materials: [{ name: String, url: String, size: Number, uploadedAt: { type: Date, default: Date.now } }],
  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'active' },
  tags: [String],
  startDate: { type: Date },
  endDate: { type: Date },
  syllabus: { type: String },                     // Course outline/syllabus text
  difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },

  // ─── NEW: Configurable pass mark (default 70%) ───
  passMark: { type: Number, default: 70, min: 30, max: 100 },

  // Allow unlimited quiz attempts (training mode). Default false keeps formal
  // exams single-attempt. When true, a plain (non pre/post) quiz can be retaken.
  retakesAllowed: { type: Boolean, default: false },

  // ─── NEW: Certificate signatory (Chief Master Trainer) ───
  // Printed on the completion certificate's signature line. Editable per
  // training; carried onto the issued Credential so the PDF renders it.
  signatory: {
    name: { type: String, default: '[Chief Master Trainer]', maxlength: 120 },
    title: { type: String, default: 'Chief Master Trainer', maxlength: 120 },
  },

  // ─── Associated trainers (co-trainers/facilitators) ───
  associatedTrainers: [{
    name: { type: String, maxlength: 120 },
    role: { type: String, maxlength: 120, default: 'Trainer' },
    email: { type: String, maxlength: 160 },
  }],

  // ─── Certificate issuers (partner organisations shown on the certificate) ───
  issuers: [{ type: String, maxlength: 160 }],

  // ─── Certificate partner logos (uploads filenames) shown in the top corners ───
  logos: [{ type: String, maxlength: 200 }],

  // ─── Certificate signatories (name, title, org + optional signature image) ───
  signatories: [{
    name: { type: String, maxlength: 120 },
    title: { type: String, maxlength: 120 },
    org: { type: String, maxlength: 120 },
    signatureUrl: { type: String },   // served at /api/uploads/<file>
  }],

  // ─── Trainers assessed by participants (drives the Trainer Assessment survey) ───
  trainers: [{
    key: { type: String },          // stable id used in submitted ratings
    name: { type: String, maxlength: 120 },
    topic: { type: String, maxlength: 160 },
    order: { type: Number },
  }],
  // ─── Submitted trainer-assessment responses (one per worker, anonymous in results) ───
  trainerAssessments: [{
    worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker' },
    submittedAt: { type: Date, default: Date.now },
    comment: { type: String, maxlength: 2000 },
    ratings: [{
      key: String,
      clarity: { type: Number, min: 1, max: 5 },
      knowledge: { type: Number, min: 1, max: 5 },
      timekeeping: { type: Number, min: 1, max: 5 },
      examples: { type: Number, min: 1, max: 5 },
      engagement: { type: Number, min: 1, max: 5 },
      overall: { type: Number, min: 0, max: 100 },   // avg of the 5 x 20
    }],
  }],

  // ─── Survey-activity submissions (per module, one per worker) ───
  surveySubmissions: [{
    module: { type: mongoose.Schema.Types.ObjectId },
    worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker' },
    respondentName: { type: String, maxlength: 120 },  // set on public (no-login) submissions
    isPublic: { type: Boolean, default: false },
    submittedAt: { type: Date, default: Date.now },
    answers: [{
      qi: { type: Number },            // question index
      choice: { type: String },        // single-choice answer
      choices: [{ type: String }],     // multi-choice answers
      text: { type: String, maxlength: 2000 },  // free-text answer
    }],
  }],

  // ─── NEW: Weighted grading configuration ───
  gradingConfig: {
    weights: {
      quiz: { type: Number, default: 40, min: 0, max: 100 },
      practical: { type: Number, default: 35, min: 0, max: 100 },
      scenario: { type: Number, default: 15, min: 0, max: 100 },
      participation: { type: Number, default: 10, min: 0, max: 100 },
    },
    competencyThresholds: {
      foundation: { type: Number, default: 40 },
      intermediate: { type: Number, default: 55 },
      advanced: { type: Number, default: 70 },
      expert: { type: Number, default: 85 },
    },
    enforceCompetencyThresholds: { type: Boolean, default: true },
  },

  // ─── NEW: Competency targets for this course ───
  competencyTargets: [{
    skill: { type: String, required: true },
    targetLevel: { type: String, enum: ['foundation', 'intermediate', 'advanced', 'expert'], default: 'intermediate' },
  }],

  // ─── NEW: Transferable/meta skills taught ───
  transferableSkills: [{
    name: { type: String },           // "Problem Solving", "Safety Reasoning", "Quality Assessment"
    description: { type: String },
  }],

  // ─── NEW: Cohort & pacing ───
  cohort: {
    enabled: { type: Boolean, default: false },
    startDate: { type: Date },
    dailyTargetMinutes: { type: Number, default: 60 },
    weeklyModuleTarget: { type: Number, default: 3 },
  },

  // ─── NEW: Content freshness ───
  lastReviewedAt: { type: Date },
  nextReviewDate: { type: Date },
  contentVersion: { type: Number, default: 1 },

  // ─── NEW: Pathway reference ───
  pathway: { type: mongoose.Schema.Types.ObjectId, ref: 'Pathway' },

  // ─── NEW: Category for program grouping ───
  category: {
    type: String,
    enum: ['trade-core', 'safety', 'gulf-readiness', 'digital', 'soft-skills', 'specialization', 'general'],
    default: 'trade-core',
  },

  // ─── NEW: Curriculum framework (NAVTTC vs Gulf/City & Guilds) ───
  framework: { type: String, enum: ['navttc', 'gulf', 'custom'], default: 'navttc' },

  // ─── NEW: Credit hours and structured duration ───
  totalHours: { type: Number, min: 0 },                // Total contact hours (e.g., 360)
  credits: { type: Number, min: 0 },                    // Academic credits (e.g., 36)

  // ─── NEW: International standards alignment ───
  iscedCode: { type: String },                           // ISCED-F 2013 code (e.g., '0732')
  eqfLevel: { type: Number, min: 1, max: 8 },           // European Qualifications Framework level
  qualificationCode: { type: String },                   // NAVTTC code (e.g., 'F45-Mason') or C&G code (e.g., 'CG-6705')
  // versionKey disabled: this doc holds ALL enrollments, and every learner action
  // (exercise/quiz submit, cert issuance, progress) does a nested-array write then
  // save(). Mongoose's __v guard rejected all-but-one concurrent save with a
  // VersionError (500) — so a burst of learners taking the pre/post test together
  // would mostly fail. Each learner only mutates their own enrollment index and
  // joins only append, so per-member writes never collide; dropping __v makes the
  // concurrent nested $push/$set writes succeed. See the credential Counter fix too.
}, { timestamps: true, versionKey: false });

// Indexes for enrollment scalability
trainingSchema.index({ trade: 1, status: 1 });
trainingSchema.index({ 'enrollments.worker': 1 });
trainingSchema.index({ 'enrollments.status': 1 });
trainingSchema.index({ 'notifications.recipient': 1, 'notifications.read': 1 });
trainingSchema.index({ title: 'text', trade: 'text', tags: 'text' });
trainingSchema.index({ difficulty: 1 });
trainingSchema.index({ framework: 1 });
trainingSchema.index({ 'ratings.score': 1 });

// Virtual: average rating
trainingSchema.virtual('avgRating').get(function () {
  if (!this.ratings || this.ratings.length === 0) return 0;
  return Math.round(this.ratings.reduce((s, r) => s + r.score, 0) / this.ratings.length * 10) / 10;
});

trainingSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Training', trainingSchema);
