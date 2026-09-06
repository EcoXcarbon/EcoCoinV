import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },  // e.g. 'credential', 'worker'
  seq: { type: Number, default: 0 },
});

/**
 * Atomically increment and return the next sequence value.
 * Uses findOneAndUpdate with upsert for thread-safe ID generation.
 */
counterSchema.statics.getNextSequence = async function (name) {
  const counter = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return counter.seq;
};

export default mongoose.model('Counter', counterSchema);
