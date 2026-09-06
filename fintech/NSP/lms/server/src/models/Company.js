import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const companySchema = new mongoose.Schema({
  companyId: { type: String, default: () => `CO-${uuidv4().slice(0, 8).toUpperCase()}`, unique: true },
  name: { type: String, required: true, trim: true },
  nameLocal: { type: String, trim: true },
  type: {
    type: String,
    enum: ['DIRECT_EMPLOYER', 'RECRUITMENT_AGENCY', 'CONTRACTOR', 'STAFFING_AGENCY'],
    default: 'DIRECT_EMPLOYER',
  },
  sector: { type: String, trim: true },
  trades: [{ type: String }],
  location: {
    country: { type: String, required: true },
    countryCode: { type: String },
    city: { type: String },
    region: { type: String },
  },
  contact: {
    website: { type: String },
    email: { type: String },
    phone: { type: String },
  },
  registration: {
    beoeNumber: { type: String },
    pecNumber: { type: String },
    mohreNumber: { type: String },
    source: { type: String },
  },
  size: {
    type: String,
    enum: ['MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE'],
    default: 'MEDIUM',
  },
  hiringStatus: {
    type: String,
    enum: ['ACTIVELY_HIRING', 'OCCASIONALLY', 'NOT_HIRING'],
    default: 'OCCASIONALLY',
  },
  verificationStatus: {
    type: String,
    enum: ['VERIFIED', 'UNVERIFIED', 'PENDING'],
    default: 'UNVERIFIED',
  },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive: { type: Boolean, default: true },
  source: { type: String, default: 'SEED' },
}, { timestamps: true });

companySchema.index({ name: 'text', nameLocal: 'text' });
companySchema.index({ 'location.country': 1, sector: 1 });
companySchema.index({ hiringStatus: 1 });
companySchema.index({ type: 1 });

export default mongoose.model('Company', companySchema);
