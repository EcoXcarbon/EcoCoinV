import { v4 as uuid } from 'uuid';
import XAPIStatement from '../models/XAPIStatement.js';

/* ═══════════════════════════════════════════════════════════
   GAP 5: xAPI SERVICE
   Builds and stores xAPI 1.0.3 statements for learning events
   ═══════════════════════════════════════════════════════════ */

// Predefined verb registry (ADL xAPI vocabulary)
const VERBS = {
  completed: { id: 'http://adlnet.gov/expapi/verbs/completed', display: { 'en-US': 'completed' } },
  passed: { id: 'http://adlnet.gov/expapi/verbs/passed', display: { 'en-US': 'passed' } },
  failed: { id: 'http://adlnet.gov/expapi/verbs/failed', display: { 'en-US': 'failed' } },
  attempted: { id: 'http://adlnet.gov/expapi/verbs/attempted', display: { 'en-US': 'attempted' } },
  experienced: { id: 'http://adlnet.gov/expapi/verbs/experienced', display: { 'en-US': 'experienced' } },
  registered: { id: 'http://adlnet.gov/expapi/verbs/registered', display: { 'en-US': 'registered' } },
  progressed: { id: 'http://adlnet.gov/expapi/verbs/progressed', display: { 'en-US': 'progressed' } },
  earned: { id: 'http://adlnet.gov/expapi/verbs/earned', display: { 'en-US': 'earned' } },
  launched: { id: 'http://adlnet.gov/expapi/verbs/launched', display: { 'en-US': 'launched' } },
  suspended: { id: 'http://adlnet.gov/expapi/verbs/suspended', display: { 'en-US': 'suspended' } },
  terminated: { id: 'http://adlnet.gov/expapi/verbs/terminated', display: { 'en-US': 'terminated' } },
  voided: { id: 'http://adlnet.gov/expapi/verbs/voided', display: { 'en-US': 'voided' } },
};

const ACTIVITY_TYPES = {
  course: 'http://adlnet.gov/expapi/activities/course',
  module: 'http://adlnet.gov/expapi/activities/module',
  assessment: 'http://adlnet.gov/expapi/activities/assessment',
  question: 'http://adlnet.gov/expapi/activities/question',
};

const BASE_IRI = 'https://talentledger.ppmc.org.pk';

export function buildActor(worker) {
  return {
    mbox: `mailto:${worker.registrationId || worker._id}@talentledger.ppmc.org.pk`,
    name: worker.fullName || worker.name || 'Worker',
    objectType: 'Agent',
  };
}

export function buildVerb(verbKey) {
  return VERBS[verbKey] || { id: `http://adlnet.gov/expapi/verbs/${verbKey}`, display: { 'en-US': verbKey } };
}

export function buildActivity(type, id, name, description) {
  return {
    id: `${BASE_IRI}/${type}/${id}`,
    objectType: 'Activity',
    definition: {
      name: { 'en-US': name },
      description: description ? { 'en-US': description } : undefined,
      type: ACTIVITY_TYPES[type] || ACTIVITY_TYPES.module,
    },
  };
}

/**
 * Emit an xAPI statement and store in the LRS.
 * Non-blocking — errors are logged but don't fail the calling operation.
 */
export async function emitStatement({ actor, verb, object, result, context }) {
  try {
    const statement = {
      id: uuid(),
      actor,
      verb: typeof verb === 'string' ? buildVerb(verb) : verb,
      object,
      result: result || undefined,
      context: context || undefined,
      timestamp: new Date(),
      stored: new Date(),
    };

    await XAPIStatement.create(statement);
    return statement;
  } catch (err) {
    console.error('xAPI emit error:', err.message);
    return null;
  }
}

// Convenience emitters for common events

export async function emitModuleCompleted(worker, programId, programTitle, moduleId, moduleTitle) {
  return emitStatement({
    actor: buildActor(worker),
    verb: 'completed',
    object: buildActivity('module', moduleId, moduleTitle),
    result: { completion: true },
    context: {
      contextActivities: {
        parent: [{ id: `${BASE_IRI}/course/${programId}`, objectType: 'Activity' }],
      },
    },
  });
}

export async function emitQuizAttempted(worker, programId, moduleId, moduleTitle, score, passed) {
  return emitStatement({
    actor: buildActor(worker),
    verb: passed ? 'passed' : 'failed',
    object: buildActivity('assessment', moduleId, moduleTitle),
    result: {
      score: { scaled: score / 100, raw: score, min: 0, max: 100 },
      success: passed,
      completion: true,
    },
    context: {
      contextActivities: {
        parent: [{ id: `${BASE_IRI}/course/${programId}`, objectType: 'Activity' }],
      },
    },
  });
}

export async function emitCourseCompleted(worker, programId, programTitle) {
  return emitStatement({
    actor: buildActor(worker),
    verb: 'completed',
    object: buildActivity('course', programId, programTitle),
    result: { completion: true },
  });
}

export async function emitCourseRegistered(worker, programId, programTitle) {
  return emitStatement({
    actor: buildActor(worker),
    verb: 'registered',
    object: buildActivity('course', programId, programTitle),
  });
}

export async function emitCertificateEarned(worker, credentialId, title) {
  return emitStatement({
    actor: buildActor(worker),
    verb: 'earned',
    object: buildActivity('course', credentialId, title),
    result: { completion: true },
  });
}

export async function emitRPLEvidenceSubmitted(worker, assessmentId, title) {
  return emitStatement({
    actor: buildActor(worker),
    verb: 'experienced',
    object: buildActivity('assessment', assessmentId, `RPL Evidence: ${title}`),
  });
}

export async function emitAssessmentCompleted(worker, assessmentId, title, score) {
  return emitStatement({
    actor: buildActor(worker),
    verb: 'completed',
    object: buildActivity('assessment', assessmentId, title),
    result: score !== undefined ? { score: { scaled: score / 100, raw: score, min: 0, max: 100 }, completion: true } : { completion: true },
  });
}
