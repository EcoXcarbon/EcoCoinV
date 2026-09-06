import nodemailer from 'nodemailer';
import env from '../config/env.js';

let transporter;

if (env.SMTP_USER && env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

export async function sendEmail({ to, subject, html }) {
  if (!transporter) {
    console.log(`[Email stub] To: ${to} | Subject: ${subject}`);
    return;
  }
  return transporter.sendMail({
    from: `"TalentLedger" <${env.SMTP_USER}>`,
    to, subject, html,
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendCredentialNotification(worker, credential) {
  const name = escapeHtml(worker.fullName);
  const title = escapeHtml(credential.title);
  const credId = escapeHtml(credential.credentialId);
  const trade = escapeHtml(credential.trade);
  const nqf = escapeHtml(credential.nqfLevel);
  const validUntil = credential.validUntil?.toISOString().split('T')[0] || 'N/A';
  const verifyUrl = `${env.CLIENT_URL}/verify/${encodeURIComponent(credential.credentialId)}`;

  return sendEmail({
    to: worker.user?.email || '',
    subject: `Your TalentLedger Credential ${credId} Has Been Issued`,
    html: `
      <h2>Congratulations, ${name}!</h2>
      <p>Your <strong>${title}</strong> credential has been issued.</p>
      <p><strong>Credential ID:</strong> ${credId}</p>
      <p><strong>Trade:</strong> ${trade}</p>
      <p><strong>NQF Level:</strong> ${nqf}</p>
      <p><strong>Valid Until:</strong> ${escapeHtml(validUntil)}</p>
      <p>Verify at: <a href="${escapeHtml(verifyUrl)}">TalentLedger Verification Portal</a></p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

export async function sendPasswordResetEmail(user, resetToken) {
  const name = escapeHtml(user.name);
  const resetUrl = `${env.CLIENT_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
  return sendEmail({
    to: user.email,
    subject: 'TalentLedger — Password Reset Request',
    html: `
      <h2>Password Reset</h2>
      <p>Hello ${name},</p>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:10px 20px;background:#002D72;color:white;text-decoration:none;border-radius:8px">Reset Password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

export async function sendAssessmentStageEmail(worker, assessment, stage, details) {
  const name = escapeHtml(worker.fullName);
  const stageNames = {
    'pre-screening': 'Pre-Screening Completed',
    'evidence': 'Evidence Submitted',
    'document-review': 'Documents Reviewed',
    'interview': 'Interview Completed',
    'practical-demo': 'Practical Demo Completed',
    'decision': 'Final Decision Made',
    'moderation': 'Moderation Complete',
    'appeal-result': 'Appeal Decision',
  };
  const stageName = stageNames[stage] || stage;
  return sendEmail({
    to: worker.user?.email || '',
    subject: `TalentLedger — RPL Assessment: ${stageName}`,
    html: `
      <h2>Assessment Update</h2>
      <p>Hello ${name},</p>
      <p>Your RPL assessment for <strong>${escapeHtml(assessment.trade)}</strong> has reached a new stage:</p>
      <p style="font-size:18px;font-weight:bold;color:#002D72">${escapeHtml(stageName)}</p>
      ${details ? `<p>${escapeHtml(details)}</p>` : ''}
      <p>Log in to TalentLedger to view details.</p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

export async function sendEnrollmentEmail(worker, program) {
  const name = escapeHtml(worker.fullName);
  return sendEmail({
    to: worker.user?.email || '',
    subject: `TalentLedger — Enrolled in ${program.title}`,
    html: `
      <h2>Course Enrollment Confirmed</h2>
      <p>Hello ${name},</p>
      <p>You have been enrolled in <strong>${escapeHtml(program.title)}</strong>.</p>
      <p><strong>Trade:</strong> ${escapeHtml(program.trade)}</p>
      <p><strong>NQF Level:</strong> ${program.nqfLevel || 'N/A'}</p>
      <p><strong>Modules:</strong> ${program.modules?.length || 0}</p>
      <p>Log in to TalentLedger to start learning.</p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

export async function sendQuizResultEmail(worker, program, moduleName, score, passed) {
  const name = escapeHtml(worker.fullName);
  return sendEmail({
    to: worker.user?.email || '',
    subject: `TalentLedger — Quiz Result: ${passed ? 'Passed' : 'Needs Retry'}`,
    html: `
      <h2>Quiz Result</h2>
      <p>Hello ${name},</p>
      <p>Your quiz result for <strong>${escapeHtml(moduleName)}</strong> in ${escapeHtml(program.title)}:</p>
      <p style="font-size:24px;font-weight:bold;color:${passed ? '#16a34a' : '#dc2626'}">${score}% — ${passed ? 'PASSED' : 'NOT PASSED'}</p>
      ${!passed ? '<p>You can retry the quiz in the LMS.</p>' : '<p>Congratulations! Move on to the next module.</p>'}
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

export async function sendSubmissionReviewEmail(worker, program, moduleName, status, feedback) {
  const name = escapeHtml(worker.fullName);
  return sendEmail({
    to: worker.user?.email || '',
    subject: `TalentLedger — Assignment ${status === 'approved' ? 'Approved' : 'Reviewed'}`,
    html: `
      <h2>Assignment Review</h2>
      <p>Hello ${name},</p>
      <p>Your submission for <strong>${escapeHtml(moduleName)}</strong> in ${escapeHtml(program.title)} has been reviewed:</p>
      <p style="font-size:18px;font-weight:bold;color:${status === 'approved' ? '#16a34a' : '#dc2626'}">${escapeHtml(status.toUpperCase())}</p>
      ${feedback ? `<p><strong>Feedback:</strong> ${escapeHtml(feedback)}</p>` : ''}
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

// --- Stage 1: Email verification ---
export async function sendEmailVerification(user, verificationToken) {
  const name = escapeHtml(user.name);
  const verifyUrl = `${env.CLIENT_URL}/verify-email?token=${encodeURIComponent(verificationToken)}`;
  return sendEmail({
    to: user.email,
    subject: 'TalentLedger — Verify Your Email Address',
    html: `
      <h2>Welcome to TalentLedger!</h2>
      <p>Hello ${name},</p>
      <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
      <p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:12px 24px;background:#002D72;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Verify Email Address</a></p>
      <p>This link expires in 24 hours. If you didn't create an account, ignore this email.</p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

// --- Stage 1: Account lockout notification ---
// New sign-in alert: fires when the login IP differs from the last known IP
export async function sendNewSignInAlert(user, { ip, userAgent, when }) {
  const name = escapeHtml(user.name);
  const safeIp = escapeHtml(ip || 'unknown');
  const safeUa = escapeHtml((userAgent || 'unknown').slice(0, 240));
  const whenStr = escapeHtml((when || new Date()).toUTCString());
  return sendEmail({
    to: user.email,
    subject: 'TalentLedger — New sign-in detected',
    html: `
      <h2>New sign-in to your TalentLedger account</h2>
      <p>Hello ${name},</p>
      <p>Your account was just signed in from a device or location we haven't seen before:</p>
      <ul>
        <li><strong>IP address:</strong> ${safeIp}</li>
        <li><strong>Browser / device:</strong> ${safeUa}</li>
        <li><strong>Time (UTC):</strong> ${whenStr}</li>
      </ul>
      <p>If this was you, you can ignore this email.</p>
      <p>If you don't recognise this sign-in, your account may be compromised:
        change your password immediately and enable two-step verification under Profile → Security.</p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — automated alert</p>
    `,
  });
}

export async function sendAccountLockedEmail(user) {
  const name = escapeHtml(user.name);
  return sendEmail({
    to: user.email,
    subject: 'TalentLedger — Account Temporarily Locked',
    html: `
      <h2>Account Security Alert</h2>
      <p>Hello ${name},</p>
      <p>Your TalentLedger account has been temporarily locked due to multiple failed login attempts.</p>
      <p>The account will be automatically unlocked after <strong>15 minutes</strong>.</p>
      <p>If this wasn't you, please reset your password immediately after the lockout period.</p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

// --- Stage 2: Welcome email sequence ---
export async function sendWelcomeEmail(user) {
  const name = escapeHtml(user.name);
  const role = escapeHtml(user.role);
  const loginUrl = `${env.CLIENT_URL}/login`;
  const roleGuides = {
    worker: `
      <li>Complete your profile (add CNIC, trade, photo)</li>
      <li>Add your next-of-kin and passport details for Gulf readiness</li>
      <li>Explore training programs and enroll in courses</li>
      <li>Build your Skills Passport with verifiable credentials</li>
    `,
    employer: `
      <li>Complete your organization profile</li>
      <li>Browse the worker directory by trade and skill</li>
      <li>Verify worker credentials using QR codes</li>
      <li>Post job requirements and find matched workers</li>
    `,
    assessor: `
      <li>Review assigned workers for RPL assessment</li>
      <li>Conduct practical demonstrations and interviews</li>
      <li>Issue competency assessments and recommendations</li>
    `,
    institution: `
      <li>Manage training programs and modules</li>
      <li>Track learner progress and completions</li>
      <li>Issue verifiable credentials</li>
      <li>View analytics and reports</li>
    `,
  };
  return sendEmail({
    to: user.email,
    subject: 'Welcome to TalentLedger Skills Passport!',
    html: `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif">
        <div style="background:#002D72;color:white;padding:30px;text-align:center;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:28px">Welcome to TalentLedger</h1>
          <p style="margin:8px 0 0;opacity:0.9">Skills Passport — Powered by W3C Verifiable Credentials</p>
        </div>
        <div style="padding:30px;background:#f9fafb;border-radius:0 0 12px 12px">
          <p>Hello <strong>${name}</strong>,</p>
          <p>Your <strong>${role}</strong> account has been successfully created. Here's how to get started:</p>
          <h3 style="color:#002D72">Getting Started Checklist:</h3>
          <ol>${roleGuides[user.role] || roleGuides.worker}</ol>
          <p style="text-align:center;margin:25px 0">
            <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 30px;background:#002D72;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Log In to TalentLedger</a>
          </p>
          <p>Need help? Contact support at <a href="mailto:support@talentledger.pk">support@talentledger.pk</a></p>
        </div>
        <p style="color:#888;font-size:12px;text-align:center;margin-top:15px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
      </div>
    `,
  });
}

// --- Stage 2: Credential expiry notification ---
export async function sendCredentialExpiryNotification(worker, credential, daysRemaining) {
  const name = escapeHtml(worker.fullName);
  const title = escapeHtml(credential.title || credential.trade);
  const expiryDate = credential.validUntil?.toISOString().split('T')[0] || 'N/A';
  const urgency = daysRemaining <= 7 ? '#dc2626' : daysRemaining <= 30 ? '#f59e0b' : '#002D72';
  return sendEmail({
    to: worker.user?.email || '',
    subject: `TalentLedger — Credential Expiring in ${daysRemaining} Days`,
    html: `
      <h2>Credential Expiry Notice</h2>
      <p>Hello ${name},</p>
      <p>Your credential <strong>${title}</strong> is expiring soon:</p>
      <p style="font-size:18px;font-weight:bold;color:${urgency}">Expires: ${escapeHtml(expiryDate)} (${daysRemaining} days remaining)</p>
      <p>Please contact your assessor or institution to renew your credential before it expires.</p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

// --- Stage 2: Passport expiry notification ---
export async function sendPassportExpiryNotification(worker, daysRemaining) {
  const name = escapeHtml(worker.fullName);
  const expiryDate = worker.passport?.expiryDate?.toISOString().split('T')[0] || 'N/A';
  return sendEmail({
    to: worker.user?.email || '',
    subject: `TalentLedger — Passport Expiring in ${daysRemaining} Days`,
    html: `
      <h2>Passport Expiry Alert</h2>
      <p>Hello ${name},</p>
      <p>Your passport is expiring soon:</p>
      <p style="font-size:18px;font-weight:bold;color:#dc2626">Expires: ${escapeHtml(expiryDate)} (${daysRemaining} days remaining)</p>
      <p>Please renew your passport as soon as possible to maintain Gulf readiness.</p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}

export async function sendCourseCompleteEmail(worker, program, grade) {
  const name = escapeHtml(worker.fullName);
  return sendEmail({
    to: worker.user?.email || '',
    subject: 'TalentLedger — Course Completed! Certificate Issued',
    html: `
      <h2>Congratulations, ${name}!</h2>
      <p>You have completed <strong>${escapeHtml(program.title)}</strong>.</p>
      ${grade ? `<p><strong>Grade:</strong> ${escapeHtml(String(grade))}%</p>` : ''}
      <p>Your certificate has been issued and is available in your Wallet.</p>
      <p>Log in to download your PDF certificate and share the verification link with employers.</p>
      <hr>
      <p style="color:#888;font-size:12px">TalentLedger Skills Passport — PPMC Khyber Pakhtunkhwa</p>
    `,
  });
}
