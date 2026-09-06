/* ═══════════════════════════════════════════════════════════
   GAP 8: EXTERNAL MODERATION CONFIGURATION
   Configurable sampling rates and mandatory trade lists
   ═══════════════════════════════════════════════════════════ */

// Percentage of assessments randomly sampled for external moderation
export const EXTERNAL_MODERATION_SAMPLE_RATE = 0.20; // 20%

// Safety-critical trades: ALWAYS require external moderation
export const EXTERNAL_MODERATION_MANDATORY_TRADES = [
  'electrician', 'welder', 'rigger', 'crane-operator', 'scaffolder',
  'heavy-equipment-operator', 'heavy-driver', 'pipe-fitter', 'safety-officer',
];

// New assessors: first N assessments always externally moderated
export const EXTERNAL_MODERATION_NEW_ASSESSOR_THRESHOLD = 10;

/**
 * Determine if an assessment requires external moderation.
 * Called after internal moderation completes.
 *
 * @param {Object} assessment - The assessment document
 * @param {Number} assessorCompletedCount - Number of assessments this assessor has completed
 * @returns {Boolean} Whether external moderation is required
 */
export function requiresExternalModeration(assessment, assessorCompletedCount = 0) {
  // 1. Safety-critical trades always require external moderation
  if (EXTERNAL_MODERATION_MANDATORY_TRADES.includes(assessment.trade)) {
    return true;
  }

  // 2. New assessors (< threshold completed) always require external moderation
  if (assessorCompletedCount < EXTERNAL_MODERATION_NEW_ASSESSOR_THRESHOLD) {
    return true;
  }

  // 3. Random sampling at configured rate
  if (Math.random() < EXTERNAL_MODERATION_SAMPLE_RATE) {
    return true;
  }

  return false;
}
