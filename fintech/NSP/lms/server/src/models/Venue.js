import mongoose from 'mongoose';

const venueSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 300 },
  address: { type: String, required: true, maxlength: 500 },
  city: { type: String, required: true, maxlength: 100 },
  district: { type: String, required: true, maxlength: 100 },
  province: { type: String, maxlength: 100, default: 'Khyber Pakhtunkhwa' },
  type: {
    type: String,
    enum: ['assessment-centre', 'workshop', 'training-centre', 'employer-site', 'field-site', 'mobile-unit', 'other'],
    required: true,
  },
  capacity: { type: Number, min: 1 },
  facilities: [{ type: String, maxlength: 100 }],
  contact: {
    name: { type: String, maxlength: 200 },
    phone: { type: String, maxlength: 20 },
    email: { type: String, maxlength: 254 },
  },
  gpsCoordinates: {
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
  },
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

venueSchema.index({ type: 1, active: 1 });
venueSchema.index({ district: 1 });
venueSchema.index({ city: 1 });

export default mongoose.model('Venue', venueSchema);
