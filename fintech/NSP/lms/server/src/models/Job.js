import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema({
  worker: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', required: true },
  coverNote: { type: String, maxlength: 1000 },
  status: { type: String, enum: ['applied', 'shortlisted', 'interviewed', 'offered', 'rejected', 'withdrawn'], default: 'applied' },
  appliedAt: { type: Date, default: Date.now },
  statusUpdatedAt: { type: Date },
  statusUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  feedback: { type: String, maxlength: 500 },
}, { _id: true });

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 300 },
  description: { type: String, required: true, maxlength: 5000 },
  employer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employerName: { type: String, required: true },
  trade: {
    type: String, required: true,
    enum: [
      'mason','electrician','welder','plumber','carpenter','steel-fixer','painter','hvac',
      'pipe-fitter','scaffolder','rigger','crane-operator','heavy-driver','shuttering-carpenter',
      'tile-fixer','duct-fabricator','auto-mechanic','diesel-mechanic','fabricator',
      'insulation-worker','heavy-equipment-operator','aluminium-fabricator','safety-officer',
      'cook','ac-technician',
    ],
  },
  location: {
    country: { type: String, default: 'Pakistan' },
    city: { type: String },
    district: { type: String },
    isGulf: { type: Boolean, default: false },
  },
  requirements: {
    minNqfLevel: { type: Number, min: 1, max: 8 },
    minExperienceYears: { type: Number, default: 0 },
    gulfReadinessRequired: { type: Boolean, default: false },
    certifiedOnly: { type: Boolean, default: false },
    skills: [String],
  },
  salary: {
    min: { type: Number },
    max: { type: Number },
    currency: { type: String, default: 'PKR' },
    period: { type: String, enum: ['monthly', 'daily', 'hourly', 'contract'], default: 'monthly' },
  },
  positions: { type: Number, default: 1 },
  deadline: { type: Date },
  status: { type: String, enum: ['draft', 'active', 'closed', 'filled'], default: 'active' },
  applications: [applicationSchema],
}, { timestamps: true });

jobSchema.index({ trade: 1, status: 1 });
jobSchema.index({ employer: 1 });
jobSchema.index({ 'location.district': 1 });
jobSchema.index({ deadline: 1 });
jobSchema.index({ title: 'text', description: 'text' });

export default mongoose.model('Job', jobSchema);
