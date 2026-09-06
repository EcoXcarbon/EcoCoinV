// W3C Verifiable Credential JSON-LD Schema Definitions for Talent Ledger
// Compliant with W3C VC Data Model 2.0 and Open Badges 3.0

const TL_CONTEXT = 'https://credentials.talentledger.pk/v1';
const W3C_VC_CONTEXT = 'https://www.w3.org/2018/credentials/v1';
const W3C_VC2_CONTEXT = 'https://www.w3.org/ns/credentials/v2';
const OB3_CONTEXT = 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json';

export const CREDENTIAL_CONTEXTS = {
  base: [W3C_VC2_CONTEXT, TL_CONTEXT],
  withOpenBadges: [W3C_VC2_CONTEXT, OB3_CONTEXT, TL_CONTEXT],
};

// Schema definitions for each Talent Ledger credential type
export const CREDENTIAL_SCHEMAS = {
  ACADEMIC: {
    type: ['VerifiableCredential', 'TalentLedgerAcademicCredential'],
    schemaUrl: `${TL_CONTEXT}/schemas/academic`,
    requiredFields: ['degreeLevel', 'degreeTitle', 'institutionName'],
  },
  TVET: {
    type: ['VerifiableCredential', 'TalentLedgerTVETCredential'],
    schemaUrl: `${TL_CONTEXT}/schemas/tvet`,
    requiredFields: ['nvqLevel', 'tradeName', 'boardName'],
  },
  RPL: {
    type: ['VerifiableCredential', 'TalentLedgerRPLCredential'],
    schemaUrl: `${TL_CONTEXT}/schemas/rpl`,
    requiredFields: ['assessedTrade', 'competencyLevel'],
  },
  PROFESSIONAL_LICENSE: {
    type: ['VerifiableCredential', 'TalentLedgerProfessionalLicense'],
    schemaUrl: `${TL_CONTEXT}/schemas/professional-license`,
    requiredFields: ['licenseNumber', 'licensingBody'],
  },
  MICRO_CREDENTIAL: {
    type: ['VerifiableCredential', 'TalentLedgerMicroCredential', 'OpenBadgeCredential'],
    schemaUrl: `${TL_CONTEXT}/schemas/micro-credential`,
    requiredFields: ['platform', 'courseName'],
    useOpenBadges: true,
  },
  EMPLOYER_ENDORSEMENT: {
    type: ['VerifiableCredential', 'TalentLedgerEmployerEndorsement'],
    schemaUrl: `${TL_CONTEXT}/schemas/employer-endorsement`,
    requiredFields: ['employerName', 'jobTitle'],
  },
  TRAINING_RECORD: {
    type: ['VerifiableCredential', 'TalentLedgerTrainingRecord'],
    schemaUrl: `${TL_CONTEXT}/schemas/training-record`,
    requiredFields: ['programName', 'trainingProvider'],
  },
  IDENTITY_VERIFICATION: {
    type: ['VerifiableCredential', 'TalentLedgerIdentityAttestation'],
    schemaUrl: `${TL_CONTEXT}/schemas/identity-attestation`,
    requiredFields: ['documentType', 'verificationSource'],
  },
  MIGRATION_RECORD: {
    type: ['VerifiableCredential', 'TalentLedgerMigrationRecord'],
    schemaUrl: `${TL_CONTEXT}/schemas/migration-record`,
    requiredFields: ['recordType', 'destinationCountry'],
  },
  HEALTH_CLEARANCE: {
    type: ['VerifiableCredential', 'TalentLedgerHealthClearance'],
    schemaUrl: `${TL_CONTEXT}/schemas/health-clearance`,
    requiredFields: ['examinationType', 'fitnessCategory'],
  },
  SELF_DECLARED: {
    type: ['VerifiableCredential', 'TalentLedgerSelfDeclaredSkill'],
    schemaUrl: `${TL_CONTEXT}/schemas/self-declared`,
    requiredFields: ['skillName', 'proficiencyLevel'],
  },
};

export default { CREDENTIAL_CONTEXTS, CREDENTIAL_SCHEMAS };
