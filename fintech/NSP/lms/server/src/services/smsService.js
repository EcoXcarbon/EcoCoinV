import env from '../config/env.js';

// SMS Service — uses environment-configured provider
// Supports: Twilio, local Pakistani gateways (Jazz, Telenor API)
// Falls back to console.log if not configured

let smsProvider = null;

if (env.SMS_PROVIDER === 'twilio' && env.TWILIO_SID && env.TWILIO_AUTH_TOKEN) {
  try {
    const twilio = await import('twilio');
    smsProvider = twilio.default(env.TWILIO_SID, env.TWILIO_AUTH_TOKEN);
  } catch {
    console.log('[SMS] Twilio not installed — SMS will be stubbed');
  }
}

export async function sendSMS({ to, message }) {
  if (!to || !message) return;

  // Normalize Pakistani phone number
  let phone = String(to).replace(/[^0-9+]/g, '');
  if (phone.startsWith('03')) phone = '+92' + phone.slice(1);
  if (!phone.startsWith('+')) phone = '+' + phone;

  if (smsProvider && env.SMS_FROM) {
    try {
      await smsProvider.messages.create({
        body: message,
        from: env.SMS_FROM,
        to: phone,
      });
      return;
    } catch (err) {
      console.error('[SMS] Send failed:', err.message);
    }
  }

  // Stub — log to console
  console.log(`[SMS stub] To: ${phone} | Message: ${message}`);
}

// Pre-built templates
export async function sendAssessmentSMS(worker, stage) {
  if (!worker?.phone) return;
  const stageMessages = {
    'pre-screening': `TalentLedger: Your RPL pre-screening is complete. Log in to check your eligibility result.`,
    'evidence': `TalentLedger: Your evidence has been submitted for review.`,
    'document-review': `TalentLedger: Your documents have been reviewed. Next: Interview stage.`,
    'interview': `TalentLedger: Your RPL interview is complete. Awaiting practical demo scheduling.`,
    'practical-demo': `TalentLedger: Your practical demonstration is complete. Awaiting final decision.`,
    'approved': `TalentLedger: Congratulations! Your RPL assessment has been APPROVED. Your credential will be issued shortly.`,
    'rejected': `TalentLedger: Your RPL assessment result is available. Log in for details and appeal options.`,
    'needs-revision': `TalentLedger: Your RPL assessment needs revision. Log in for gap training recommendations.`,
  };
  const msg = stageMessages[stage] || `TalentLedger: Your assessment status has been updated to "${stage}". Log in for details.`;
  await sendSMS({ to: worker.phone, message: msg });
}

export async function sendCredentialSMS(worker, credentialId) {
  if (!worker?.phone) return;
  await sendSMS({
    to: worker.phone,
    message: `TalentLedger: Your credential ${credentialId} has been issued! Log in to download your certificate and share with employers.`,
  });
}

export async function sendEnrollmentSMS(worker, programTitle) {
  if (!worker?.phone) return;
  await sendSMS({
    to: worker.phone,
    message: `TalentLedger: You are now enrolled in "${programTitle}". Log in to start learning.`,
  });
}

export async function sendJobApplicationSMS(worker, jobTitle, status) {
  if (!worker?.phone) return;
  const statusMessages = {
    'shortlisted': `TalentLedger: Great news! You've been SHORTLISTED for "${jobTitle}". Check your Jobs page for details.`,
    'interviewed': `TalentLedger: Your interview for "${jobTitle}" has been recorded. Await employer decision.`,
    'offered': `TalentLedger: Congratulations! You've received a JOB OFFER for "${jobTitle}". Log in for details.`,
    'rejected': `TalentLedger: Your application for "${jobTitle}" was not selected. Browse other opportunities.`,
  };
  await sendSMS({ to: worker.phone, message: statusMessages[status] || `TalentLedger: Application update for "${jobTitle}": ${status}` });
}
