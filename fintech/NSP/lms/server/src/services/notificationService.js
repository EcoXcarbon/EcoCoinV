import Notification from '../models/Notification.js';
import Worker from '../models/Worker.js';
import { sendAssessmentStageEmail, sendCredentialExpiryNotification } from './emailService.js';

/**
 * Gap #22: Real-time RPL progress notification system
 * Creates in-app notifications and sends emails for RPL stage changes
 */

const STAGE_MESSAGES = {
  'pre-screening': {
    title: 'Pre-Screening Completed',
    message: 'Your RPL pre-screening self-assessment has been submitted. Your assessor will review your eligibility.',
  },
  'evidence-submission': {
    title: 'Evidence Submitted',
    message: 'Your documentary evidence has been uploaded successfully. It will now be reviewed by your assessor.',
  },
  'document-review': {
    title: 'Documents Reviewed',
    message: 'Your assessor has completed the document review. You will be scheduled for an interview.',
  },
  'interview': {
    title: 'Interview Completed',
    message: 'Your structured interview has been completed. Next step: practical demonstration.',
  },
  'practical-demo': {
    title: 'Practical Demo Completed',
    message: 'Your practical demonstration has been assessed. Your assessor will now make a decision.',
  },
  'consent-submitted': {
    title: 'Consent Form Submitted',
    message: 'Your RPL consent/agreement form has been recorded. You may now proceed with the assessment.',
  },
  'assessor-assigned': {
    title: 'Assessor Assigned',
    message: 'An assessor has been assigned to your RPL assessment.',
  },
  'decision-approved': {
    title: 'RPL Assessment Approved',
    message: 'Congratulations! Your RPL assessment has been approved. A credential will be issued shortly.',
  },
  'decision-rejected': {
    title: 'RPL Assessment — Gap Training Required',
    message: 'Your RPL assessment requires further development. Gap training recommendations have been provided.',
  },
  'moderation-complete': {
    title: 'Moderation Complete',
    message: 'Internal moderation of your RPL assessment has been completed.',
  },
  'external-moderation-required': {
    title: 'External Moderation Required',
    message: 'Your RPL assessment has been selected for external moderation. This is a quality assurance process.',
  },
  'external-moderation-complete': {
    title: 'External Moderation Complete',
    message: 'External moderation has been completed for your RPL assessment.',
  },
  'appeal-submitted': {
    title: 'Appeal Submitted',
    message: 'Your appeal has been submitted and will be reviewed by an independent reviewer.',
  },
  'appeal-result': {
    title: 'Appeal Decision',
    message: 'A decision has been made on your RPL assessment appeal.',
  },
  'partial-recognition': {
    title: 'Partial Recognition Issued',
    message: 'You have received partial RPL recognition for completed competency units.',
  },
  'video-evidence-reviewed': {
    title: 'Video Evidence Reviewed',
    message: 'Your submitted video evidence has been reviewed by the assessor.',
  },
  'credential-expiring': {
    title: 'Credential Expiring Soon',
    message: 'One of your RPL credentials is expiring soon. Please arrange for renewal.',
  },
};

export async function createRPLNotification({ recipientUserId, stage, assessment, details, worker }) {
  const template = STAGE_MESSAGES[stage] || { title: 'RPL Update', message: details || 'Your RPL assessment has been updated.' };
  const message = details || template.message;

  const notification = await Notification.create({
    recipient: recipientUserId,
    type: stage.startsWith('credential') ? 'credential-expiring' : 'rpl-stage-change',
    title: template.title,
    message,
    link: assessment ? `/assessments/${assessment._id}` : undefined,
    assessment: assessment?._id,
    worker: worker?._id,
    metadata: { stage, trade: assessment?.trade },
  });

  // Also send email (fire-and-forget)
  if (worker && assessment) {
    const populatedWorker = worker.user?.email ? worker : await Worker.findById(worker._id).populate('user', 'email');
    sendAssessmentStageEmail(populatedWorker, assessment, stage, message).catch(() => {});
  }

  return notification;
}

export async function createCredentialExpiryNotification({ recipientUserId, credential, worker, daysRemaining }) {
  const notification = await Notification.create({
    recipient: recipientUserId,
    type: 'credential-expiring',
    title: `Credential Expiring in ${daysRemaining} Days`,
    message: `Your credential "${credential.title}" for ${credential.trade} expires on ${credential.validUntil?.toISOString().split('T')[0]}. Please arrange renewal.`,
    link: `/credentials/${credential._id}`,
    credential: credential._id,
    worker: worker?._id,
    metadata: { daysRemaining, credentialId: credential.credentialId },
  });

  // Send email too
  if (worker) {
    const populatedWorker = worker.user?.email ? worker : await Worker.findById(worker._id).populate('user', 'email');
    sendCredentialExpiryNotification(populatedWorker, credential, daysRemaining).catch(() => {});
  }

  return notification;
}

export async function getUnreadCount(userId) {
  return Notification.countDocuments({ recipient: userId, read: false });
}

export async function markAsRead(notificationId, userId) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { read: true, readAt: new Date() },
    { new: true },
  );
}

export async function markAllAsRead(userId) {
  return Notification.updateMany(
    { recipient: userId, read: false },
    { read: true, readAt: new Date() },
  );
}
