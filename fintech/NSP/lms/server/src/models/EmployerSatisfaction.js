import mongoose from 'mongoose';

const employerSatisfactionSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  credential: { type: mongoose.Schema.Types.ObjectId, ref: 'Credential' },
  employer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ratings: {
    overallPerformance: { type: Number, min: 1, max: 5, required: true },
    skillsMatch: { type: Number, min: 1, max: 5, required: true },
    safetyCompliance: { type: Number, min: 1, max: 5, required: true },
    communication: { type: Number, min: 1, max: 5, required: true },
    attitude: { type: Number, min: 1, max: 5, required: true },
    productivity: { type: Number, min: 1, max: 5, required: true },
    adaptability: { type: Number, min: 1, max: 5, required: true },
  },
  overallScore: { type: Number, min: 1, max: 5 },
  rehireIntent: { type: Boolean },
  wouldRecommend: { type: Boolean },
  rplCertificateAccurate: { type: Boolean },
  rplCertificateUseful: { type: Boolean },
  strengths: { type: String, maxlength: 2000 },
  areasForImprovement: { type: String, maxlength: 2000 },
  trade: { type: String },
  country: { type: String, maxlength: 100 },
  status: {
    type: String,
    enum: ['submitted', 'verified', 'disputed'],
    default: 'submitted',
  },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: { type: Date },
}, { timestamps: true });

// Auto-calculate overallScore before save
employerSatisfactionSchema.pre('save', function (next) {
  const r = this.ratings;
  if (r) {
    const vals = [r.overallPerformance, r.skillsMatch, r.safetyCompliance, r.communication, r.attitude, r.productivity, r.adaptability].filter(v => v != null);
    if (vals.length > 0) {
      this.overallScore = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    }
  }
  next();
});

employerSatisfactionSchema.index({ worker: 1 });
employerSatisfactionSchema.index({ employer: 1 });
employerSatisfactionSchema.index({ trade: 1 });
employerSatisfactionSchema.index({ status: 1 });

export default mongoose.model('EmployerSatisfaction', employerSatisfactionSchema);
