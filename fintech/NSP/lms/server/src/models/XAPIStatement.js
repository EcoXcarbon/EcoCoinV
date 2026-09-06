import mongoose from 'mongoose';

/* ═══════════════════════════════════════════════════════════
   GAP 5: xAPI STATEMENT MODEL (Learning Record Store)
   Stores xAPI 1.0.3 compliant statements
   ═══════════════════════════════════════════════════════════ */

const xapiStatementSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  actor: {
    mbox: { type: String },
    name: { type: String },
    objectType: { type: String, default: 'Agent' },
  },
  verb: {
    id: { type: String, required: true },
    display: { type: Map, of: String },
  },
  object: {
    id: { type: String, required: true },
    objectType: { type: String, default: 'Activity' },
    definition: {
      name: { type: Map, of: String },
      description: { type: Map, of: String },
      type: { type: String },
    },
  },
  result: {
    score: {
      scaled: { type: Number },
      raw: { type: Number },
      min: { type: Number },
      max: { type: Number },
    },
    success: { type: Boolean },
    completion: { type: Boolean },
    duration: { type: String },
  },
  context: {
    registration: { type: String },
    contextActivities: {
      parent: [{ id: String, objectType: { type: String, default: 'Activity' } }],
      grouping: [{ id: String, objectType: { type: String, default: 'Activity' } }],
    },
  },
  timestamp: { type: Date, default: Date.now },
  stored: { type: Date, default: Date.now },
  authority: {
    mbox: { type: String, default: 'mailto:system@talentledger.ppmc.org.pk' },
    name: { type: String, default: 'TalentLedger LRS' },
    objectType: { type: String, default: 'Agent' },
  },
}, { timestamps: false });

xapiStatementSchema.index({ timestamp: 1 });
xapiStatementSchema.index({ 'actor.mbox': 1 });
xapiStatementSchema.index({ 'verb.id': 1 });
xapiStatementSchema.index({ 'object.id': 1 });

export default mongoose.model('XAPIStatement', xapiStatementSchema);
