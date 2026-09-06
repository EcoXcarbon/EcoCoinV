import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ─── Icons ────────────────────────────────────────────────────────────────────
function Check() {
  return (
    <svg className="w-4 h-4 text-green-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
function X() {
  return (
    <svg className="w-4 h-4 text-white/20 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
function CheckDark() {
  return (
    <svg className="w-4 h-4 text-green-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
function XDark() {
  return (
    <svg className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const SUBSCRIPTION_PLANS = [
  {
    id: 'free',
    name: 'Free',
    pkr: 'PKR 0',
    usd: '$0',
    period: 'forever',
    target: 'Individual worker',
    highlight: false,
    features: [
      '1 worker profile',
      'Up to 5 credentials in wallet',
      'Basic Skills Passport',
      'Public credential verification (QR)',
      'Google OAuth login',
      'Email verification',
      'Community support',
    ],
    missing: ['LMS access', 'RPL pipeline', 'Analytics', 'Bulk registration', 'E-Portfolio', 'API access'],
    cta: 'Get Started',
    ctaLink: '/register',
  },
  {
    id: 'starter',
    name: 'Starter',
    pkr: 'PKR 2,500',
    usd: '~$9',
    period: 'per month',
    target: 'Small training centers',
    highlight: false,
    features: [
      'Up to 50 worker profiles',
      '25 credentials',
      'Basic LMS (5 courses)',
      'Basic quiz types (MCQ, T/F)',
      'Progress tracking',
      'PDF certificates',
      'Bulk CSV registration (50)',
      'Basic analytics dashboard',
      'Email support',
    ],
    missing: ['Full RPL pipeline', 'SCORM/xAPI', 'AI adaptive learning', 'Gamification', 'E-Portfolio', 'API access'],
    cta: 'Start Free Trial',
    ctaLink: '/register',
  },
  {
    id: 'professional',
    name: 'Professional',
    pkr: 'PKR 15,000',
    usd: '~$49',
    period: 'per month',
    target: 'TVET institutes, assessment bodies',
    highlight: true,
    badge: 'Most Popular',
    features: [
      'Up to 500 worker profiles',
      'Unlimited credentials',
      'Full LMS (10 courses, all module types)',
      'All 9 quiz question types',
      'Full RPL pipeline (all 6 phases)',
      'Moderation & appeals system',
      'E-Portfolio system',
      'Gulf readiness tracking',
      'Gamification (badges, XP, streaks)',
      'Learning pathways (6 categories)',
      'Advanced analytics & reports',
      'Bulk CSV registration (500)',
      'Tracer studies (6-month & 2-year)',
      'W3C Verifiable Credentials v2.0',
      'Email + chat support',
    ],
    missing: ['SCORM/xAPI (add-on)', 'AI features (add-on)', 'Blockchain anchoring (add-on)', 'API access (add-on)', 'White-label'],
    cta: 'Start Free Trial',
    ctaLink: '/register',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    pkr: 'Custom',
    usd: 'Custom',
    period: 'contact us',
    target: 'Government, NVQF bodies, large employers',
    highlight: false,
    features: [
      'Unlimited worker profiles',
      'All Professional features',
      'SCORM 1.2 & 2004 support',
      'xAPI / built-in LRS',
      'AI adaptive learning (included)',
      'Blockchain anchoring (included)',
      'API access + webhooks (included)',
      'Gulf Package (included)',
      'National Skills Registry integration',
      'Multi-center RPL management',
      'Custom NQF frameworks',
      'SSO / SAML integration',
      'Custom branding & white-label',
      'Dedicated account manager',
      'SLA 99.9% uptime guarantee',
      'On-premise / private cloud deployment',
      'Priority 24/7 support',
    ],
    missing: [],
    cta: 'Contact Sales',
    ctaLink: 'mailto:sales@talentledger.pk',
  },
];

const RPL_PLANS = [
  {
    name: 'Pay-Per-Assessment',
    price: 'PKR 3,500',
    sub: 'per assessment',
    color: 'from-slate-700 to-slate-800',
    features: [
      'All 6 RPL phases',
      'Pre-screening self-assessment',
      'Evidence submission (6 categories)',
      'Document review workflow',
      'Interview with competency mapping',
      'Practical demonstration scoring',
      'PDF RPL certificate on completion',
      'Appeal mechanism',
    ],
  },
  {
    name: 'RPL Center',
    price: 'PKR 45,000',
    sub: 'per month',
    color: 'from-blue-700 to-blue-900',
    badge: 'Best Value',
    features: [
      'Up to 50 assessments/month',
      'All Pay-Per features',
      'Moderation & second reviewer',
      'External moderator access',
      'Assessor management portal',
      'Inter-rater reliability analytics',
      'Video evidence support',
      'Competency unit partial recognition',
      'Gap training recommendations',
      'Witness testimonies & workplace obs.',
    ],
  },
  {
    name: 'RPL Body',
    price: 'Custom',
    sub: 'contact us',
    color: 'from-purple-700 to-purple-900',
    features: [
      'Unlimited assessments',
      'All RPL Center features',
      'Multi-center management',
      'Custom NQF competency frameworks',
      'Government reporting API',
      'National RPL authority integration',
      'Bulk assessor onboarding',
      'Custom moderation workflows',
    ],
  },
];

const LMS_PLANS = [
  {
    name: 'LMS Basic',
    price: 'Included',
    sub: 'in Professional plan',
    color: 'bg-slate-700',
    features: [
      '10 courses',
      'Video & reading modules',
      'MCQ & True/False quizzes',
      'Progress tracking',
      'PDF certificates on completion',
      'Basic learner analytics',
    ],
  },
  {
    name: 'LMS Advanced',
    price: 'PKR 10,000',
    sub: 'per month (add-on)',
    color: 'bg-blue-800',
    badge: 'Recommended',
    features: [
      'Unlimited courses & modules',
      'All 9 quiz question types',
      'SCORM 1.2 & 2004 support',
      'xAPI / built-in LRS',
      'Scenario-based branching modules',
      'AI adaptive learning paths',
      'Gamification (badges, XP, streaks)',
      'Learning pathways (6 categories)',
      'Transcript generation',
      'Tracer studies integration',
      'Knowledge checks & pre-assessments',
      'Rubric-based practical evaluation',
    ],
  },
  {
    name: 'LMS Per-Learner',
    price: 'PKR 500',
    sub: 'per learner / month',
    color: 'bg-indigo-800',
    features: [
      'All LMS Advanced features',
      'Volume discounts (100+ learners)',
      'Dedicated learner portal',
      'Cohort management',
      'Bulk enrollment via CSV',
      'Per-cohort analytics',
    ],
  },
];

const CREDENTIAL_PLANS = [
  { name: 'Standard Credential', price: 'PKR 200', sub: 'per credential', items: ['W3C Verifiable Credential v2.0', 'Ed25519 digital signature', 'QR code for verification', 'PDF certificate', 'ISCO/ISCED/EQF mapping', '1-year validity'] },
  { name: 'Blockchain-Anchored', price: 'PKR 500', sub: 'per credential', badge: 'Tamper-Proof', items: ['All Standard features', 'Ethereum / Polygon anchoring', 'Immutable transaction hash', 'Block number & Merkle root', 'Content hash (SHA-256)', 'Permanent on-chain proof'] },
  { name: 'Bulk Pack — 50', price: 'PKR 8,000', sub: 'pre-paid batch', items: ['50 standard credentials', 'PKR 160/credential (20% off)', 'API or dashboard issuance', 'Bulk PDF generation', 'Valid for 12 months'] },
  { name: 'Bulk Pack — 200', price: 'PKR 25,000', sub: 'pre-paid batch', items: ['200 standard credentials', 'PKR 125/credential (37% off)', 'API or dashboard issuance', 'Priority processing', 'Valid for 12 months'] },
  { name: 'Unlimited Credentials', price: 'Included', sub: 'Professional & Enterprise', items: ['No per-unit charge', 'All credential types', 'Blockchain option available', 'Revocation management', 'MRA recognition tracking'] },
];

const ADDONS = [
  { name: 'AI Features', price: 'PKR 5,000/mo', icon: '🤖', desc: 'Adaptive learning paths, gap analysis, quiz difficulty AI, content recommendations via Claude' },
  { name: 'Blockchain Anchoring', price: 'PKR 3,000/mo', icon: '⛓️', desc: 'All credentials anchored to Ethereum/Polygon — unlimited, immutable proof of issuance' },
  { name: 'API Access', price: 'PKR 8,000/mo', icon: '🔌', desc: 'REST API, webhooks, API key management, 10K calls/day, third-party integrations' },
  { name: 'Gulf Package', price: 'PKR 8,000/mo', icon: '✈️', desc: 'Gulf readiness scoring, pre-departure tracking, passport/visa/medical management, Gulf job board' },
  { name: 'Registry Integration', price: 'PKR 15,000/mo', icon: '🗂️', desc: 'National Skills Registry, CNIC-based lookup, DID management, status lists, bulk ops' },
  { name: 'White-Label', price: 'PKR 25,000/mo', icon: '🏷️', desc: 'Custom domain, full branding, custom certificate design, remove TalentLedger logo, custom emails' },
  { name: 'SSO / SAML', price: 'PKR 10,000/mo', icon: '🔐', desc: 'Enterprise identity provider integration (Azure AD, Okta, Google Workspace, custom SAML 2.0)' },
  { name: 'SCORM + xAPI', price: 'PKR 6,000/mo', icon: '📦', desc: 'SCORM 1.2 & 2004 package hosting, built-in xAPI LRS, activity state persistence, statement queries' },
];

const REGISTRY_PLANS = [
  {
    name: 'Registry Basic',
    price: 'Free',
    sub: 'included in all plans',
    color: 'from-slate-700 to-slate-800',
    features: [
      'Worker Skills Passport (public)',
      'QR credential verification',
      'Credential status lookup',
      'Basic holder profile (CNIC-masked)',
      'W3C Verifiable Credential v2.0',
    ],
  },
  {
    name: 'Registry Pro',
    price: 'PKR 15,000',
    sub: 'per month',
    color: 'from-blue-700 to-blue-900',
    badge: 'Recommended',
    features: [
      'All Basic features',
      'Full CNIC-based holder registry',
      'Multi-issuer management (9 types)',
      'Bulk credential operations',
      'DID (Decentralized Identifier) management',
      'Credential schema enforcement',
      'Revocation status list management',
      'Selective Disclosure JWT (SD-JWT)',
      'API key generation for 3rd-party integrations',
      'Verification log & audit trail',
    ],
  },
  {
    name: 'National Registry',
    price: 'Custom',
    sub: 'government & NVQF bodies',
    color: 'from-purple-700 to-purple-900',
    features: [
      'All Pro features',
      'National Skills Registry integration',
      'Unlimited issuers (all 9 types)',
      'Blockchain-anchored credentials',
      'OpenID Connect / OIDC4VCI support',
      'JWKS & DID configuration endpoints',
      'Inter-ministry data sharing API',
      'Bulk CNIC-based lookup',
      'Custom credential schemas',
      'Government reporting & exports',
    ],
  },
];

const ISSUER_TYPES = [
  { type: 'Government Body', example: 'NAVTTC, PBTE, TEVTA', included: 'National Registry' },
  { type: 'University / HEI', example: 'UET, NUST, COMSATS', included: 'Registry Pro+' },
  { type: 'BTE / TTB', example: 'Board of Technical Education', included: 'Registry Pro+' },
  { type: 'Professional Body', example: 'PEC, PMC, ICAP', included: 'Registry Pro+' },
  { type: 'Training Provider', example: 'TVET centers, skill labs', included: 'Registry Pro+' },
  { type: 'Employer', example: 'Corporate skill endorsements', included: 'Registry Pro+' },
  { type: 'Assessment Center', example: 'RPL assessment bodies', included: 'Registry Pro+' },
  { type: 'Platform', example: 'Online course providers', included: 'Registry Basic' },
  { type: 'TalentLedger RPL', example: 'TL-issued RPL certificates', included: 'All Plans' },
];

const EMPLOYER_PLANS = [
  {
    name: 'Employer Basic',
    price: 'Free',
    sub: 'forever',
    features: ['Search certified workers', 'Verify credentials (QR / ID)', 'View public Skills Passports', 'Basic talent discovery'],
    missing: ['Job postings', 'Shortlisting', 'Workforce analytics', 'Satisfaction surveys'],
  },
  {
    name: 'Employer Pro',
    price: 'PKR 5,000',
    sub: 'per month',
    badge: 'Recommended',
    features: ['All Basic features', 'Post up to 10 job listings', 'Worker shortlisting & pipeline', 'Application tracking (6 stages)', 'Employer satisfaction surveys', 'Workforce analytics dashboard', 'Gulf & domestic job board'],
    missing: ['Bulk verification API', 'Dedicated talent pipeline'],
  },
  {
    name: 'Employer Enterprise',
    price: 'PKR 20,000',
    sub: 'per month',
    features: ['All Pro features', 'Unlimited job postings', 'Bulk credential verification API', 'Dedicated talent pipeline', 'Workforce reporting & export', 'Priority candidate matching', 'Onboarding integration', 'Dedicated account manager'],
    missing: [],
  },
];

const FEATURE_MATRIX = [
  { feature: 'Worker profiles', free: '1', starter: '50', pro: '500', ent: 'Unlimited' },
  { feature: 'Skills Passport', free: true, starter: true, pro: true, ent: true },
  { feature: 'Credential wallet', free: '5', starter: '25', pro: 'Unlimited', ent: 'Unlimited' },
  { feature: 'Google OAuth', free: true, starter: true, pro: true, ent: true },
  { feature: 'LMS — Basic courses', free: false, starter: '5 courses', pro: '10 courses', ent: 'Unlimited' },
  { feature: 'LMS — All 9 quiz types', free: false, starter: false, pro: 'Add-on', ent: true },
  { feature: 'SCORM / xAPI', free: false, starter: false, pro: 'Add-on', ent: true },
  { feature: 'RPL Pipeline (6 phases)', free: false, starter: 'Basic', pro: true, ent: true },
  { feature: 'RPL Moderation & appeals', free: false, starter: false, pro: true, ent: true },
  { feature: 'Bulk CSV registration', free: false, starter: '50', pro: '500', ent: 'API unlimited' },
  { feature: 'E-Portfolio', free: false, starter: false, pro: true, ent: true },
  { feature: 'Gamification / Badges', free: false, starter: false, pro: true, ent: true },
  { feature: 'W3C Verifiable Credentials', free: false, starter: 'Basic', pro: true, ent: true },
  { feature: 'Blockchain anchoring', free: false, starter: false, pro: 'Add-on', ent: 'Included' },
  { feature: 'Gulf readiness tracking', free: false, starter: false, pro: 'Add-on', ent: 'Included' },
  { feature: 'AI adaptive learning', free: false, starter: false, pro: 'Add-on', ent: 'Included' },
  { feature: 'Tracer studies', free: false, starter: false, pro: true, ent: true },
  { feature: 'Analytics & reports', free: false, starter: 'Basic', pro: 'Advanced', ent: 'Full + custom' },
  { feature: 'API access + webhooks', free: false, starter: false, pro: 'Add-on', ent: 'Included' },
  { feature: 'SSO / SAML', free: false, starter: false, pro: false, ent: 'Add-on' },
  { feature: 'White-label / Custom brand', free: false, starter: false, pro: false, ent: 'Add-on' },
  { feature: 'SLA guarantee', free: false, starter: false, pro: false, ent: '99.9%' },
  { feature: 'Support', free: 'Community', starter: 'Email', pro: 'Email + Chat', ent: 'Dedicated 24/7' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function MatrixCell({ val }) {
  if (val === true) return <span className="flex justify-center"><CheckDark /></span>;
  if (val === false) return <span className="flex justify-center"><XDark /></span>;
  return <span className="text-xs text-center text-gray-600 dark:text-gray-400">{val}</span>;
}

function SectionTitle({ title, subtitle }) {
  return (
    <div className="text-center mb-10">
      <h2 className="text-2xl sm:text-3xl font-bold text-white">{title}</h2>
      {subtitle && <p className="mt-2 text-white/60 text-sm max-w-xl mx-auto">{subtitle}</p>}
    </div>
  );
}

function Badge({ text }) {
  return <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-ilo-blue text-white text-xs font-bold px-3 py-1 rounded-full shadow whitespace-nowrap">{text}</span>;
}

// ─── Section Components ────────────────────────────────────────────────────────

function SubscriptionSection({ user }) {
  return (
    <section className="mb-20">
      <SectionTitle title="Subscription Plans" subtitle="Choose the right plan for your organization size and needs." />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {SUBSCRIPTION_PLANS.map(plan => (
          <div key={plan.id} className={`relative flex flex-col rounded-2xl p-5 shadow-xl ${plan.highlight ? 'bg-white dark:bg-navy-mid ring-2 ring-ilo-blue' : 'bg-white/10 backdrop-blur-sm text-white'}`}>
            {plan.badge && <Badge text={plan.badge} />}
            <div className="mb-4">
              <h3 className={`text-base font-bold ${plan.highlight ? 'text-gray-900 dark:text-white' : 'text-white'}`}>{plan.name}</h3>
              <p className={`text-xs mt-0.5 ${plan.highlight ? 'text-gray-500 dark:text-gray-400' : 'text-white/50'}`}>{plan.target}</p>
              <div className="mt-2">
                <span className={`text-2xl font-black ${plan.highlight ? 'text-gray-900 dark:text-white' : 'text-white'}`}>{plan.pkr}</span>
                <span className={`text-xs ml-1 ${plan.highlight ? 'text-gray-400' : 'text-white/50'}`}>/ {plan.period}</span>
              </div>
              {plan.usd !== plan.pkr && <p className={`text-xs ${plan.highlight ? 'text-gray-400' : 'text-white/40'}`}>{plan.usd}</p>}
            </div>
            <ul className="flex-1 space-y-1.5 mb-5">
              {plan.features.map(f => (
                <li key={f} className="flex items-start gap-1.5 text-xs">
                  {plan.highlight ? <CheckDark /> : <Check />}
                  <span className={plan.highlight ? 'text-gray-700 dark:text-gray-300' : 'text-white/85'}>{f}</span>
                </li>
              ))}
              {plan.missing.map(f => (
                <li key={f} className="flex items-start gap-1.5 text-xs opacity-40">
                  {plan.highlight ? <XDark /> : <X />}
                  <span className={plan.highlight ? 'text-gray-500' : 'text-white/60'}>{f}</span>
                </li>
              ))}
            </ul>
            {plan.ctaLink.startsWith('mailto:') ? (
              <a href={plan.ctaLink} className={`block text-center py-2 rounded-xl font-semibold text-xs transition-all ${plan.highlight ? 'bg-gradient-to-r from-ilo-blue to-ilo-dark text-white hover:shadow-lg' : 'bg-white/20 hover:bg-white/30 text-white'}`}>{plan.cta}</a>
            ) : (
              <Link to={user ? '/' : plan.ctaLink} className={`block text-center py-2 rounded-xl font-semibold text-xs transition-all ${plan.highlight ? 'bg-gradient-to-r from-ilo-blue to-ilo-dark text-white hover:shadow-lg' : 'bg-white/20 hover:bg-white/30 text-white'}`}>
                {user && user.plan === plan.id ? 'Current Plan' : plan.cta}
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RPLSection() {
  return (
    <section className="mb-20">
      <SectionTitle title="RPL Pricing" subtitle="Recognition of Prior Learning — flexible options for individuals and assessment centers." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {RPL_PLANS.map(plan => (
          <div key={plan.name} className={`relative flex flex-col rounded-2xl p-5 bg-gradient-to-br ${plan.color} text-white shadow-xl`}>
            {plan.badge && <Badge text={plan.badge} />}
            <h3 className="text-base font-bold">{plan.name}</h3>
            <div className="mt-1 mb-4">
              <span className="text-2xl font-black">{plan.price}</span>
              <span className="text-xs ml-1 text-white/60">/ {plan.sub}</span>
            </div>
            <ul className="flex-1 space-y-1.5">
              {plan.features.map(f => (
                <li key={f} className="flex items-start gap-1.5 text-xs">
                  <Check /><span className="text-white/85">{f}</span>
                </li>
              ))}
            </ul>
            <a href="mailto:sales@talentledger.pk" className="mt-5 block text-center py-2 rounded-xl font-semibold text-xs bg-white/20 hover:bg-white/30 transition-all">
              {plan.price === 'Custom' ? 'Contact Sales' : 'Get Started'}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

function LMSSection() {
  return (
    <section className="mb-20">
      <SectionTitle title="LMS Pricing" subtitle="Learning Management System — from basic courses to full adaptive learning with SCORM and AI." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {LMS_PLANS.map(plan => (
          <div key={plan.name} className={`relative flex flex-col rounded-2xl p-5 ${plan.color} text-white shadow-xl`}>
            {plan.badge && <Badge text={plan.badge} />}
            <h3 className="text-base font-bold">{plan.name}</h3>
            <div className="mt-1 mb-4">
              <span className="text-2xl font-black">{plan.price}</span>
              <span className="text-xs ml-1 text-white/60">/ {plan.sub}</span>
            </div>
            <ul className="flex-1 space-y-1.5">
              {plan.features.map(f => (
                <li key={f} className="flex items-start gap-1.5 text-xs">
                  <Check /><span className="text-white/85">{f}</span>
                </li>
              ))}
            </ul>
            <a href="mailto:sales@talentledger.pk" className="mt-5 block text-center py-2 rounded-xl font-semibold text-xs bg-white/20 hover:bg-white/30 transition-all">Get Started</a>
          </div>
        ))}
      </div>
    </section>
  );
}

function CredentialSection() {
  return (
    <section className="mb-20">
      <SectionTitle title="Certification & Credentials" subtitle="Issue tamper-proof, internationally recognized verifiable credentials — pay per use or unlimited." />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {CREDENTIAL_PLANS.map(plan => (
          <div key={plan.name} className="relative flex flex-col rounded-2xl p-5 bg-white/10 backdrop-blur-sm text-white shadow-xl">
            {plan.badge && <Badge text={plan.badge} />}
            <h3 className="text-sm font-bold text-white">{plan.name}</h3>
            <div className="mt-1 mb-4">
              <span className="text-xl font-black">{plan.price}</span>
              <span className="text-xs ml-1 text-white/50">/ {plan.sub}</span>
            </div>
            <ul className="flex-1 space-y-1.5">
              {plan.items.map(f => (
                <li key={f} className="flex items-start gap-1.5 text-xs">
                  <Check /><span className="text-white/85">{f}</span>
                </li>
              ))}
            </ul>
            <a href="mailto:sales@talentledger.pk" className="mt-5 block text-center py-2 rounded-xl font-semibold text-xs bg-white/20 hover:bg-white/30 transition-all">Get Started</a>
          </div>
        ))}
      </div>
    </section>
  );
}

function AddonsSection() {
  return (
    <section className="mb-20">
      <SectionTitle title="Add-On Modules" subtitle="Extend your plan with powerful add-ons — activate only what you need." />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {ADDONS.map(addon => (
          <div key={addon.name} className="rounded-2xl p-4 bg-white/10 backdrop-blur-sm text-white shadow-xl flex flex-col gap-2">
            <div className="text-2xl">{addon.icon}</div>
            <h3 className="text-sm font-bold">{addon.name}</h3>
            <p className="text-xs text-white/60 flex-1">{addon.desc}</p>
            <p className="text-sm font-black text-gold-accent">{addon.price}</p>
            <a href="mailto:sales@talentledger.pk" className="block text-center py-1.5 rounded-xl font-semibold text-xs bg-white/20 hover:bg-white/30 transition-all">Add to Plan</a>
          </div>
        ))}
      </div>
    </section>
  );
}

function RegistrySection() {
  return (
    <section className="mb-20">
      <SectionTitle title="Registry & Issuer Pricing" subtitle="Pakistan's National Skills Registry — issue, manage, and verify credentials from any recognized body." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {REGISTRY_PLANS.map(plan => (
          <div key={plan.name} className={`relative flex flex-col rounded-2xl p-5 bg-gradient-to-br ${plan.color} text-white shadow-xl`}>
            {plan.badge && <Badge text={plan.badge} />}
            <h3 className="text-base font-bold">{plan.name}</h3>
            <div className="mt-1 mb-4">
              <span className="text-2xl font-black">{plan.price}</span>
              <span className="text-xs ml-1 text-white/60">/ {plan.sub}</span>
            </div>
            <ul className="flex-1 space-y-1.5">
              {plan.features.map(f => (
                <li key={f} className="flex items-start gap-1.5 text-xs">
                  <Check /><span className="text-white/85">{f}</span>
                </li>
              ))}
            </ul>
            <a href="mailto:sales@talentledger.pk" className="mt-5 block text-center py-2 rounded-xl font-semibold text-xs bg-white/20 hover:bg-white/30 transition-all">
              {plan.price === 'Custom' ? 'Contact Sales' : 'Get Started'}
            </a>
          </div>
        ))}
      </div>

      {/* Issuer Types Table */}
      <div className="rounded-2xl overflow-hidden shadow-xl">
        <div className="bg-white/20 px-5 py-3">
          <h3 className="text-white font-bold text-sm">Supported Issuer Types (9 Types)</h3>
          <p className="text-white/60 text-xs mt-0.5">All issuer types supported by the National Skill Passport registry</p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-white/10 text-white">
              <th className="text-left py-2.5 px-4 font-semibold">Issuer Type</th>
              <th className="text-left py-2.5 px-4 font-semibold hidden sm:table-cell">Example</th>
              <th className="text-left py-2.5 px-4 font-semibold">Included In</th>
            </tr>
          </thead>
          <tbody>
            {ISSUER_TYPES.map((row, i) => (
              <tr key={row.type} className={`${i % 2 === 0 ? 'bg-white/5' : 'bg-white/10'} text-white border-b border-white/5`}>
                <td className="py-2.5 px-4 font-medium">{row.type}</td>
                <td className="py-2.5 px-4 text-white/60 hidden sm:table-cell">{row.example}</td>
                <td className="py-2.5 px-4">
                  <span className="bg-ilo-blue/30 text-white px-2 py-0.5 rounded-full text-[10px] font-semibold">{row.included}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmployerSection() {
  return (
    <section className="mb-20">
      <SectionTitle title="Employer Plans" subtitle="Find, verify, and hire certified skilled workers — from free search to full workforce management." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {EMPLOYER_PLANS.map(plan => (
          <div key={plan.name} className="relative flex flex-col rounded-2xl p-5 bg-white/10 backdrop-blur-sm text-white shadow-xl">
            {plan.badge && <Badge text={plan.badge} />}
            <h3 className="text-base font-bold">{plan.name}</h3>
            <div className="mt-1 mb-4">
              <span className="text-2xl font-black">{plan.price}</span>
              <span className="text-xs ml-1 text-white/60">/ {plan.sub}</span>
            </div>
            <ul className="flex-1 space-y-1.5">
              {plan.features.map(f => (
                <li key={f} className="flex items-start gap-1.5 text-xs">
                  <Check /><span className="text-white/85">{f}</span>
                </li>
              ))}
              {plan.missing.map(f => (
                <li key={f} className="flex items-start gap-1.5 text-xs opacity-40">
                  <X /><span className="text-white/60">{f}</span>
                </li>
              ))}
            </ul>
            <a href="mailto:sales@talentledger.pk" className="mt-5 block text-center py-2 rounded-xl font-semibold text-xs bg-white/20 hover:bg-white/30 transition-all">
              {plan.price === 'Free' ? 'Get Started' : 'Contact Sales'}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

function MatrixSection() {
  return (
    <section className="mb-20">
      <SectionTitle title="Full Feature Comparison" subtitle="See exactly what's included in each subscription tier." />
      <div className="overflow-x-auto rounded-2xl shadow-xl">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-white/20 text-white">
              <th className="text-left py-3 px-4 font-semibold text-xs">Feature</th>
              <th className="text-center py-3 px-3 font-semibold text-xs">Free</th>
              <th className="text-center py-3 px-3 font-semibold text-xs">Starter</th>
              <th className="text-center py-3 px-3 font-semibold text-xs bg-ilo-blue/40">Professional</th>
              <th className="text-center py-3 px-3 font-semibold text-xs">Enterprise</th>
            </tr>
          </thead>
          <tbody>
            {FEATURE_MATRIX.map((row, i) => (
              <tr key={row.feature} className={`${i % 2 === 0 ? 'bg-white/5' : 'bg-white/10'} text-white border-b border-white/5`}>
                <td className="py-2.5 px-4 text-xs font-medium text-white/80">{row.feature}</td>
                <td className="py-2.5 px-3"><MatrixCell val={row.free} /></td>
                <td className="py-2.5 px-3"><MatrixCell val={row.starter} /></td>
                <td className="py-2.5 px-3 bg-ilo-blue/10"><MatrixCell val={row.pro} /></td>
                <td className="py-2.5 px-3"><MatrixCell val={row.ent} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Pricing() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState('all');

  const sections = [
    { id: 'all', label: 'All Plans' },
    { id: 'subscription', label: 'Subscriptions' },
    { id: 'rpl', label: 'RPL' },
    { id: 'lms', label: 'LMS' },
    { id: 'credentials', label: 'Credentials' },
    { id: 'registry', label: 'Registry' },
    { id: 'addons', label: 'Add-Ons' },
    { id: 'employer', label: 'Employer' },
    { id: 'compare', label: 'Compare All' },
  ];

  const show = (id) => activeSection === 'all' || activeSection === id;

  return (
    <div className="min-h-screen bg-gradient-to-br from-ilo-dark via-ilo-blue to-ilo-dark py-12 px-4">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-xl bg-white/10 mx-auto flex items-center justify-center text-gold-accent font-black text-lg mb-4">NSP</div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">NSP Learning Pricing</h1>
          <p className="mt-3 text-white/70 max-w-2xl mx-auto text-sm">
            Pakistan's most comprehensive Skills Passport platform. From individual workers to national qualification bodies — every feature priced transparently.
          </p>
          {user && (
            <p className="mt-2 text-white/50 text-sm">
              Your plan: <span className="font-semibold text-gold-accent capitalize">{user.plan || 'Free'}</span>
            </p>
          )}
        </div>

        {/* Section Nav */}
        <div className="flex overflow-x-auto gap-2 pb-2 mb-10 justify-center flex-wrap">
          {sections.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${activeSection === s.id ? 'bg-white text-ilo-dark' : 'bg-white/10 text-white hover:bg-white/20'}`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Sections */}
        {show('subscription') && <SubscriptionSection user={user} />}
        {show('rpl') && <RPLSection />}
        {show('lms') && <LMSSection />}
        {show('credentials') && <CredentialSection />}
        {show('registry') && <RegistrySection />}
        {show('addons') && <AddonsSection />}
        {show('employer') && <EmployerSection />}
        {show('compare') && <MatrixSection />}

        {/* Footer */}
        <div className="text-center text-white/50 text-xs space-y-2 pt-4 border-t border-white/10">
          <p>All prices in PKR. USD equivalents are approximate. VAT/GST not included.</p>
          <p>All plans include SSL, automatic backups, and GDPR-compliant data handling.</p>
          <p>Custom payment plans available for government and public sector organizations.</p>
          <p className="pt-2">
            Questions? <a href="mailto:sales@talentledger.pk" className="text-white hover:underline font-semibold">sales@talentledger.pk</a>
            {' · '}
            <Link to="/login" className="text-white/70 hover:text-white underline">Sign in</Link>
            {' · '}
            <Link to="/register" className="text-white/70 hover:text-white underline">Create account</Link>
          </p>
        </div>

      </div>
    </div>
  );
}
