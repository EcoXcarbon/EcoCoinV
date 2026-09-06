import mongoose from 'mongoose';

const checklistItemSchema = new mongoose.Schema({
  skill: { type: String, required: true },
  group: { type: String },                        // "Brick & Block Laying", "Safety Compliance"
  checked: { type: Boolean, default: false },
  proficiency: { type: String, enum: ['novice', 'competent', 'proficient', 'expert'] },
}, { _id: false });

const simAnswerSchema = new mongoose.Schema({
  questionId: { type: String },
  question: { type: String },
  selectedOption: { type: Number },
  correctOption: { type: Number },
  isCorrect: { type: Boolean },
}, { _id: false });

// Issue #1: Structured evidence with categories and third-party verification
const evidenceDocSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  url: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  category: {
    type: String,
    enum: ['experience-letter', 'trade-certificate', 'reference-letter', 'work-sample', 'identity-doc', 'other'],
    default: 'other',
  },
  verifiedByThirdParty: { type: Boolean, default: false },
  thirdPartyName: { type: String, maxlength: 200 },
  thirdPartyContact: { type: String, maxlength: 200 },
}, { _id: false });

// Issue #2: Structured interview with competency-mapped questions
const interviewItemSchema = new mongoose.Schema({
  competencyArea: { type: String, required: true },
  question: { type: String, required: true },
  response: { type: String },
  score: { type: Number, min: 0, max: 4 },        // 0=N/A, 1=Novice, 2=Competent, 3=Proficient, 4=Expert
}, { _id: false });

// Issue #3: Practical demo rubric with multi-criteria scoring
const demoRubricItemSchema = new mongoose.Schema({
  criterion: { type: String, required: true },
  description: { type: String },
  score: { type: Number, min: 0, max: 4 },        // 0=Not demonstrated, 1=Below standard, 2=Meets standard, 3=Above standard, 4=Exceptional
  notes: { type: String },
}, { _id: false });

// Issue #7: Moderation / second reviewer
const moderationSchema = new mongoose.Schema({
  moderator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decision: { type: String, enum: ['endorsed', 'overturned', 'referred-back'] },
  comments: { type: String, maxlength: 2000 },
  moderatedAt: { type: Date },
}, { _id: false });

// Issue #9: Appeals mechanism
const appealSchema = new mongoose.Schema({
  appealedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reason: { type: String, required: true, maxlength: 2000 },
  appealedAt: { type: Date, default: Date.now },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decision: { type: String, enum: ['pending', 'upheld', 'overturned', 'partial'] },
  reviewComments: { type: String, maxlength: 2000 },
  reviewedAt: { type: Date },
}, { _id: false });

// Issue #6 & #15: Gap training recommendation linked to LMS
const gapTrainingSchema = new mongoose.Schema({
  competencyArea: { type: String, required: true },
  currentLevel: { type: String, enum: ['not-demonstrated', 'novice', 'competent', 'proficient'] },
  requiredLevel: { type: String, enum: ['competent', 'proficient', 'expert'] },
  recommendedTraining: { type: mongoose.Schema.Types.ObjectId, ref: 'Training' },
  recommendedTrainingTitle: { type: String },
  enrolled: { type: Boolean, default: false },
  enrolledAt: { type: Date },
}, { _id: false });

// Gap #10: Video evidence for RPL portfolio
const videoEvidenceSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  url: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  duration: { type: Number },                      // seconds
  format: { type: String, enum: ['mp4', 'mov', 'avi', 'webm'], default: 'mp4' },
  fileSize: { type: Number },                      // bytes
  description: { type: String, maxlength: 500 },
  competencyArea: { type: String, maxlength: 200 },
  thumbnailUrl: { type: String },
  reviewedByAssessor: { type: Boolean, default: false },
  assessorNotes: { type: String, maxlength: 1000 },
}, { _id: false });

// Gap #29: Competency unit for partial RPL recognition
const competencyUnitSchema = new mongoose.Schema({
  unitCode: { type: String, required: true },       // e.g., CU-MASON-01
  unitTitle: { type: String, required: true },
  nqfLevel: { type: Number, min: 1, max: 8 },
  status: {
    type: String,
    enum: ['not-assessed', 'competent', 'not-yet-competent', 'partially-competent'],
    default: 'not-assessed',
  },
  assessedAt: { type: Date },
  assessedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  interviewScore: { type: Number, min: 0, max: 4 },
  demoScore: { type: Number, min: 0, max: 4 },
  evidenceSufficient: { type: Boolean },
  notes: { type: String, maxlength: 1000 },
}, { _id: false });

// Gap #33: Candidate consent/agreement
const consentSchema = new mongoose.Schema({
  agreed: { type: Boolean, default: false },
  agreedAt: { type: Date },
  agreedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  version: { type: String, default: '1.0' },
  // Specific consent items
  consentItems: {
    evidenceUsage: { type: Boolean, default: false },       // Evidence may be used for assessment
    dataHandling: { type: Boolean, default: false },        // Data processed per privacy policy
    thirdPartySharing: { type: Boolean, default: false },   // Results may be shared with employers/institutions
    photoVideoConsent: { type: Boolean, default: false },   // Photos/videos taken during assessment
    appealRights: { type: Boolean, default: false },        // Acknowledge appeal rights and process
  },
  ipAddress: { type: String },
  userAgent: { type: String, maxlength: 500 },
}, { _id: false });

// Gap #6: Challenge exam / written knowledge test
const challengeExamAnswerSchema = new mongoose.Schema({
  questionIndex: { type: Number, required: true },
  questionType: { type: String, enum: ['mcq', 'true-false', 'fill-blank', 'short-answer'], required: true },
  selectedOption: { type: Number },                   // MCQ / true-false
  textAnswer: { type: String, maxlength: 500 },       // fill-blank / short-answer
  isCorrect: { type: Boolean },
  points: { type: Number, default: 1 },
  pointsEarned: { type: Number, default: 0 },
}, { _id: false });

const challengeExamSchema = new mongoose.Schema({
  started: { type: Boolean, default: false },
  startedAt: { type: Date },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date },
  timeLimitMinutes: { type: Number, default: 60 },
  timeTakenSeconds: { type: Number },
  totalQuestions: { type: Number },
  correctAnswers: { type: Number },
  totalPoints: { type: Number },
  earnedPoints: { type: Number },
  score: { type: Number, min: 0, max: 100 },          // Percentage
  passed: { type: Boolean },
  passingScore: { type: Number, default: 60 },         // Minimum % to pass
  answers: [challengeExamAnswerSchema],
  tier: { type: String, enum: ['knowledge', 'performance', 'certified-plus'] },
}, { _id: false });

// Gap #30: Re-assessment tracking
const reassessmentSchema = new mongoose.Schema({
  parentAssessment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment' },
  reassessmentNumber: { type: Number, default: 1 },
  reason: { type: String, maxlength: 1000 },
  gapAreasToReassess: [String],
  requestedAt: { type: Date },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['requested', 'approved', 'in-progress', 'completed'], default: 'requested' },
}, { _id: false });

// Gap #2: Evidence checklist tracking
const evidenceChecklistItemSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String },
  required: { type: Boolean, default: true },
  prepared: { type: Boolean, default: false },
  preparedAt: { type: Date },
  uploadedDocIndex: { type: Number },                  // Links to documentaryEvidence index
  notes: { type: String, maxlength: 300 },
}, { _id: false });

// Gap #1: Readiness guide acknowledgment
const readinessGuideSchema = new mongoose.Schema({
  acknowledged: { type: Boolean, default: false },
  acknowledgedAt: { type: Date },
  version: { type: String, default: '1.0' },
  sectionsRead: [String],
}, { _id: false });

// Gap #11: Peer/employer witness testimony
const witnessTestimonySchema = new mongoose.Schema({
  witnessName: { type: String, required: true, maxlength: 200 },
  witnessRole: { type: String, enum: ['peer', 'employer', 'supervisor', 'client'], required: true },
  organization: { type: String, maxlength: 300 },
  contactEmail: { type: String, maxlength: 254 },
  contactPhone: { type: String, maxlength: 20 },
  relationship: { type: String, maxlength: 200 },
  competencyAreas: [String],                              // Which competencies the witness can attest to
  testimony: { type: String, required: true, maxlength: 3000 },
  yearsKnown: { type: Number, min: 0 },
  submittedAt: { type: Date, default: Date.now },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Verification
  verified: { type: Boolean, default: false },
  verifiedAt: { type: Date },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verificationMethod: { type: String, enum: ['phone', 'email', 'in-person', 'document'], default: 'email' },
  verificationNotes: { type: String, maxlength: 500 },
  // Gulf employer specifics
  isGulfEmployer: { type: Boolean, default: false },
  gulfCountry: { type: String },
  employerVerificationId: { type: String },               // Links to employer portal verification
}, { _id: true });

// Gap #8: Workplace observation
const workplaceObservationSchema = new mongoose.Schema({
  scheduledDate: { type: Date },
  conductedDate: { type: Date },
  site: { type: String, maxlength: 300 },
  siteAddress: { type: String, maxlength: 500 },
  supervisorName: { type: String, maxlength: 200 },
  supervisorContact: { type: String, maxlength: 100 },
  durationMinutes: { type: Number, min: 0 },
  tasksObserved: [{ type: String, maxlength: 200 }],
  rubric: [{
    criterion: { type: String, required: true },
    description: { type: String },
    score: { type: Number, min: 0, max: 4 },
    notes: { type: String, maxlength: 500 },
  }],
  overallResult: { type: String, enum: ['pass', 'fail', 'pending'], default: 'pending' },
  totalScore: { type: Number, min: 0, max: 100 },
  safetyCompliance: { type: Boolean },
  environmentalConditions: { type: String, maxlength: 300 },
  assessorNotes: { type: String, maxlength: 2000 },
  photos: [{ url: String, caption: String }],
}, { _id: false });

// Gap #24: Pre-departure RPL assessment
const preDepartureAssessmentSchema = new mongoose.Schema({
  targetCountry: { type: String, maxlength: 100 },
  departureDate: { type: Date },
  completedDate: { type: Date },
  checklist: {
    passportValid: { type: Boolean, default: false },
    visaObtained: { type: Boolean, default: false },
    medicalClearance: { type: Boolean, default: false },
    tradeTestPassed: { type: Boolean, default: false },
    safetyTrainingCompleted: { type: Boolean, default: false },
    languageProficiency: { type: String, enum: ['none', 'basic', 'intermediate', 'advanced'], default: 'none' },
    culturalOrientationDone: { type: Boolean, default: false },
    contractReviewed: { type: Boolean, default: false },
    insuranceCoverage: { type: Boolean, default: false },
    emergencyContactProvided: { type: Boolean, default: false },
    beoeBriefingCompleted: { type: Boolean, default: false },
    financialLiteracyTraining: { type: Boolean, default: false },
  },
  readinessScore: { type: Number, min: 0, max: 100, default: 0 },
  ready: { type: Boolean, default: false },
  blockers: [String],
  notes: { type: String, maxlength: 1000 },
}, { _id: false });

// Gap #31: RPL Scheduling
const scheduleSlotSchema = new mongoose.Schema({
  stage: {
    type: String,
    enum: ['pre-screening', 'challenge-exam', 'interview', 'practical-demo', 'workplace-observation', 'document-review', 'scenario', 'competency-conversation'],
    required: true,
  },
  scheduledDate: { type: Date, required: true },
  scheduledEndDate: { type: Date },
  venue: { type: String, maxlength: 300 },
  venueAddress: { type: String, maxlength: 500 },
  venueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Venue' },       // Gap #34: Link to Venue model
  assessor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled'], default: 'scheduled' },
  confirmedAt: { type: Date },
  cancelledReason: { type: String, maxlength: 300 },
  notes: { type: String, maxlength: 500 },
}, { _id: true });

// Gap #9: Simulation / scenario-based assessment
const scenarioSchema = new mongoose.Schema({
  scenarioId: { type: String, required: true },
  title: { type: String, required: true, maxlength: 300 },
  description: { type: String, maxlength: 2000 },
  trade: { type: String },
  difficulty: { type: String, enum: ['basic', 'intermediate', 'advanced'], default: 'intermediate' },
  timeLimit: { type: Number, min: 0 },              // minutes
  steps: [{
    stepNumber: { type: Number },
    instruction: { type: String, maxlength: 500 },
    expectedAction: { type: String, maxlength: 500 },
    candidateResponse: { type: String, maxlength: 1000 },
    score: { type: Number, min: 0, max: 4 },
    assessorNotes: { type: String, maxlength: 500 },
  }],
  overallScore: { type: Number, min: 0, max: 100 },
  passed: { type: Boolean },
  passingScore: { type: Number, default: 60 },
  startedAt: { type: Date },
  completedAt: { type: Date },
  assessorNotes: { type: String, maxlength: 2000 },
}, { _id: true });

// Gap #12: Competency conversation as standalone method
const competencyConversationSchema = new mongoose.Schema({
  conductedAt: { type: Date },
  durationMinutes: { type: Number, min: 0 },
  assessor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  format: { type: String, enum: ['in-person', 'video-call', 'phone'], default: 'in-person' },
  topics: [{
    competencyArea: { type: String, required: true, maxlength: 200 },
    questions: [{ type: String, maxlength: 500 }],
    candidateSummary: { type: String, maxlength: 1000 },
    evidenceReferenced: [{ type: String, maxlength: 200 }],
    rating: { type: Number, min: 0, max: 4 },
    notes: { type: String, maxlength: 500 },
  }],
  overallImpression: { type: String, maxlength: 2000 },
  overallScore: { type: Number, min: 0, max: 100 },
  recommendation: { type: String, enum: ['competent', 'not-yet-competent', 'needs-further-evidence', 'refer-to-practical'] },
  recordingUrl: { type: String },
  transcriptUrl: { type: String },
}, { _id: false });

// Gap #16: Inter-rater reliability check
const interRaterCheckSchema = new mongoose.Schema({
  secondAssessor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedAt: { type: Date, default: Date.now },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  completedAt: { type: Date },
  status: { type: String, enum: ['pending', 'completed', 'declined'], default: 'pending' },
  // Second assessor's independent scores
  secondScores: {
    interview: { type: Number, min: 0, max: 100 },
    practicalDemo: { type: Number, min: 0, max: 100 },
    evidenceQuality: { type: Number, min: 0, max: 100 },
    overallDecision: { type: String, enum: ['approved', 'rejected'] },
    notes: { type: String, maxlength: 2000 },
  },
  // Comparison metrics
  agreement: {
    interviewDiff: { type: Number },
    practicalDiff: { type: Number },
    evidenceDiff: { type: Number },
    decisionMatch: { type: Boolean },
    reliabilityScore: { type: Number, min: 0, max: 100 },     // Cohen's kappa-like score
    withinThreshold: { type: Boolean },                        // Within acceptable variance
  },
  resolution: {
    needed: { type: Boolean, default: false },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    finalDecision: { type: String, enum: ['approved', 'rejected'] },
    notes: { type: String, maxlength: 1000 },
    resolvedAt: { type: Date },
  },
}, { _id: true });

// Gap #3: Portfolio development template
const portfolioTemplateEntrySchema = new mongoose.Schema({
  templateId: { type: String, required: true },
  trade: { type: String, required: true },
  sections: [{
    sectionId: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String },
    required: { type: Boolean, default: true },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date },
    evidenceLinks: [{ type: Number }],                         // Indices into documentaryEvidence
    notes: { type: String, maxlength: 500 },
  }],
  progress: { type: Number, min: 0, max: 100, default: 0 },
  startedAt: { type: Date },
  lastUpdatedAt: { type: Date },
}, { _id: false });

// Gap #25: MRA mapping entry
const mraMappingSchema = new mongoose.Schema({
  sourceCountry: { type: String, required: true },
  sourceFramework: { type: String, required: true },
  sourceLevel: { type: String },
  targetCountry: { type: String, required: true },
  targetFramework: { type: String, required: true },
  targetLevel: { type: String },
  equivalencyStatus: { type: String, enum: ['full', 'partial', 'conditional', 'not-recognized'], default: 'partial' },
  conditions: { type: String, maxlength: 500 },
  verifiedAt: { type: Date },
}, { _id: false });

// Gap #5: Timeline tracking per stage
const timelineEntrySchema = new mongoose.Schema({
  stage: {
    type: String,
    enum: ['pre-screening', 'evidence-submission', 'document-review', 'interview', 'practical-demo', 'workplace-observation', 'scenario', 'competency-conversation', 'final-decision', 'moderation', 'external-moderation', 'appeal'],
    required: true,
  },
  startedAt: { type: Date },
  completedAt: { type: Date },
  estimatedDurationDays: { type: Number },
  actualDurationDays: { type: Number },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes: { type: String, maxlength: 500 },
}, { _id: false });

const assessmentSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  assessor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  // Optional for worker self-applications (assigned later)
  type: {
    type: String,
    enum: ['rpl', 'checklist', 'simulation', 'video'],
    required: true,
  },
  trade: { type: String, required: true },
  title: { type: String, required: true },
  // RPL assessment — enhanced with Issues #1-#4, #6, #7, #9, #15
  rpl: {
    // Worker self-service RPL application
    selfApplication: {
      applied: { type: Boolean, default: false },
      appliedAt: { type: Date },
      nqfLevel: { type: Number, min: 1, max: 8 },
      yearsExperience: { type: Number, min: 0 },
      motivation: { type: String, maxlength: 1000 },
      employerCountries: [String],
      previousCertifications: { type: String, maxlength: 500 },
    },
    // Gap 7: Pre-screening self-assessment (Stage 0)
    preScreening: {
      completed: { type: Boolean, default: false },
      completedAt: { type: Date },
      eligibilityScore: { type: Number, min: 0, max: 100 },
      eligible: { type: Boolean },
      responses: [{
        area: { type: String },
        question: { type: String },
        selfRating: { type: Number, min: 1, max: 5 },
        yearsExperience: { type: Number },
        hasEvidence: { type: Boolean, default: false },
      }],
      tradeExperience: {
        totalYears: { type: Number },
        formalTraining: { type: Boolean },
        formalTrainingDetails: { type: String },
        currentlyEmployed: { type: Boolean },
        employerName: { type: String },
      },
      recommendation: { type: String, enum: ['proceed', 'partial', 'not-ready'] },
      recommendedLevel: { type: Number, min: 1, max: 8 },
      gapAreas: [String],
    },
    // Issue #1: Categorized evidence portfolio
    documentaryEvidence: [evidenceDocSchema],
    evidenceSufficiency: {
      hasExperienceLetter: { type: Boolean, default: false },
      hasTradeCertificate: { type: Boolean, default: false },
      hasReferenceLetter: { type: Boolean, default: false },
      hasWorkSample: { type: Boolean, default: false },
    },
    // Issue #2: Structured interview
    interview: {
      items: [interviewItemSchema],
      overallNotes: { type: String, maxlength: 3000 },
      durationMinutes: { type: Number, min: 0 },
      conductedAt: { type: Date },
    },
    // Issue #3: Rubric-based practical demo
    practicalDemo: {
      rubric: [demoRubricItemSchema],
      overallResult: { type: String, enum: ['pass', 'fail', 'pending'], default: 'pending' },
      totalScore: { type: Number, min: 0, max: 100 },
      location: { type: String, maxlength: 300 },
      conductedAt: { type: Date },
    },
    // Issue #4: Stage gating — tracks which stages are completed
    stageCompleted: {
      preScreening: { type: Boolean, default: false },      // Gap 7: NEW
      evidenceSubmission: { type: Boolean, default: false },
      documentReview: { type: Boolean, default: false },
      interview: { type: Boolean, default: false },
      practicalDemo: { type: Boolean, default: false },
      challengeExam: { type: Boolean, default: false },     // Gap #6
      workplaceObservation: { type: Boolean, default: false }, // Gap #8
      scenario: { type: Boolean, default: false },             // Gap #9
      competencyConversation: { type: Boolean, default: false }, // Gap #12
      finalDecision: { type: Boolean, default: false },
    },
    // Legacy fields for backward compatibility during migration
    interviewNotes: { type: String },
    // Assessor's intended decision (stored when sent to moderation)
    assessorDecision: { type: String, enum: ['approved', 'rejected'] },
    // Issue #7: Moderation
    moderation: moderationSchema,
    // Gap 8: External moderation layer
    externalModeration: {
      required: { type: Boolean, default: false },
      status: { type: String, enum: ['not-required', 'pending', 'completed'], default: 'not-required' },
      moderator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      assignedAt: { type: Date },
      decision: { type: String, enum: ['endorsed', 'overturned', 'referred-back'] },
      comments: { type: String, maxlength: 2000 },
      completedAt: { type: Date },
      qualityScore: { type: Number, min: 1, max: 5 },
      findings: [String],
      assessorConsistencyFlag: { type: Boolean, default: false },
    },
    // Issue #9: Appeals
    appeal: appealSchema,
    // Issue #6 & #15: Gap training recommendations
    gapTraining: [gapTrainingSchema],
    // Gap #10: Video evidence portfolio
    videoEvidence: [videoEvidenceSchema],
    // Gap #29: Unit-based partial RPL recognition
    competencyUnits: [competencyUnitSchema],
    partialRecognition: {
      eligible: { type: Boolean, default: false },
      unitsAchieved: { type: Number, default: 0 },
      totalUnits: { type: Number, default: 0 },
      percentComplete: { type: Number, min: 0, max: 100, default: 0 },
      statementOfAttainmentIssued: { type: Boolean, default: false },
      statementIssuedAt: { type: Date },
    },
    // Gap #33: Candidate consent
    consent: consentSchema,
    // Gap #5: Timeline tracking
    timeline: [timelineEntrySchema],
    estimatedCompletionDate: { type: Date },
    actualCompletionDate: { type: Date },
    // Gap #6: Challenge exam / written knowledge test
    challengeExam: challengeExamSchema,
    // Gap #7: Three-tier credentialing
    credentialTier: { type: String, enum: ['knowledge', 'performance', 'certified-plus'] },
    // Gap #30: Re-assessment pathway
    reassessment: reassessmentSchema,
    // Gap #2: Evidence preparation checklist
    evidenceChecklist: [evidenceChecklistItemSchema],
    evidenceChecklistCompleted: { type: Boolean, default: false },
    // Gap #1: Readiness guide acknowledgment
    readinessGuide: readinessGuideSchema,
    // Gap #11: Witness testimonies
    witnessTestimonies: [witnessTestimonySchema],
    // Gap #27: Gulf employer verification
    employerVerification: {
      requested: { type: Boolean, default: false },
      requestedAt: { type: Date },
      employerName: { type: String, maxlength: 300 },
      employerCountry: { type: String, maxlength: 100 },
      employerEmail: { type: String, maxlength: 254 },
      verificationStatus: { type: String, enum: ['none', 'pending', 'verified', 'rejected', 'expired'], default: 'none' },
      verifiedAt: { type: Date },
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      verificationCode: { type: String },
      notes: { type: String, maxlength: 1000 },
    },
    // Gap #26: Language used for this assessment
    language: { type: String, enum: ['en', 'ur', 'ar'], default: 'en' },
    // Gap #8: Workplace observation
    workplaceObservation: workplaceObservationSchema,
    // Gap #24: Pre-departure RPL assessment
    preDepartureAssessment: preDepartureAssessmentSchema,
    // Gap #31: Scheduling / booking
    schedule: [scheduleSlotSchema],
    // Gap #25: MRA cross-border recognition mapping
    mraMapping: [mraMappingSchema],
    // Gap #9: Simulation/scenario-based assessment
    scenarios: [scenarioSchema],
    // Gap #12: Competency conversation
    competencyConversation: competencyConversationSchema,
    // Gap #16: Inter-rater reliability
    interRaterCheck: interRaterCheckSchema,
    // Gap #3: Portfolio development template
    portfolioTemplate: portfolioTemplateEntrySchema,
    // Gap #4: RPL advisor assignment
    advisor: {
      assignedAdvisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      assignedAt: { type: Date },
      guidanceNotes: [{ note: String, createdAt: { type: Date, default: Date.now } }],
      meetingsCount: { type: Number, default: 0 },
      lastMeetingAt: { type: Date },
      status: { type: String, enum: ['assigned', 'active', 'completed', 'withdrawn'], default: 'assigned' },
    },
    // Gap #32: Cost/Fee Tracking
    fees: {
      items: [{
        feeType: { type: String, required: true, maxlength: 100 },
        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, default: 'PKR', maxlength: 10 },
        status: { type: String, enum: ['pending', 'paid', 'waived', 'refunded', 'overdue'], default: 'pending' },
        dueDate: { type: Date },
        paidDate: { type: Date },
        paymentReference: { type: String, maxlength: 200 },
        waivedReason: { type: String, maxlength: 500 },
      }],
      totalAmount: { type: Number, default: 0, min: 0 },
      totalPaid: { type: Number, default: 0, min: 0 },
      totalWaived: { type: Number, default: 0, min: 0 },
      totalOutstanding: { type: Number, default: 0, min: 0 },
    },
    // Gap #20: AI evidence analysis results
    evidenceAnalysis: {
      analyzed: { type: Boolean, default: false },
      analyzedAt: { type: Date },
      overallScore: { type: Number, min: 0, max: 100 },
      completeness: { type: Number, min: 0, max: 100 },
      sufficiency: { type: Number, min: 0, max: 100 },
      authenticity: { type: Number, min: 0, max: 100 },
      gaps: [{ area: String, severity: { type: String, enum: ['low', 'medium', 'high'] }, recommendation: String }],
      strengths: [String],
      recommendations: [String],
      tradeSpecificChecks: [{
        check: String,
        passed: Boolean,
        notes: String,
      }],
    },
  },
  // Workplace checklist
  checklist: {
    items: [checklistItemSchema],
    site: { type: String },
    recommendation: { type: String, enum: ['pass', 'remedial', 'fail'] },
    assessorNotes: { type: String },
  },
  // Simulation / quiz
  simulation: {
    answers: [simAnswerSchema],
    totalQuestions: { type: Number },
    correctAnswers: { type: Number },
    timeTaken: { type: Number },                   // seconds
  },
  // Video portfolio
  video: {
    filename: { type: String },
    url: { type: String },
    duration: { type: Number },                    // seconds
    taskName: { type: String },
    thumbnailUrl: { type: String },
  },
  score: { type: Number, min: 0, max: 100 },
  status: {
    type: String,
    enum: ['pending', 'in-review', 'approved', 'rejected', 'needs-revision', 'awaiting-moderation', 'awaiting-external-moderation', 'appealed'],
    default: 'pending',
  },
  feedback: { type: String },
  completedAt: { type: Date },
  // Gap #23: Link to issued credential for expiry tracking
  credentialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Credential' },
  credentialExpiryDate: { type: Date },
  credentialExpiryNotified: { type: Boolean, default: false },
}, { timestamps: true });

assessmentSchema.index({ worker: 1, type: 1 });
assessmentSchema.index({ assessor: 1, status: 1 });
assessmentSchema.index({ status: 1, type: 1 });
assessmentSchema.index({ credentialExpiryDate: 1, credentialExpiryNotified: 1 }); // Gap #23

export default mongoose.model('Assessment', assessmentSchema);
