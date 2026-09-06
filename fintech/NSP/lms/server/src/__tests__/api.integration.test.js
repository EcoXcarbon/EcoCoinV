import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

/**
 * End-to-end API integration tests.
 * Boots the real Express app against an in-memory MongoDB (never touches Atlas),
 * creates sample records, and walks the core TalentLedger credentialing lifecycle.
 * Uses Bearer tokens so CSRF double-submit is bypassed (browsers can't forge them).
 */

const PW = 'Test@2026aa';
let mongod, app, User, Training;
const tok = {};
const ids = {};

const bearer = (t) => (t ? { Authorization: `Bearer ${t}` } : {});
// supertest requires the HTTP method before .set(); this helper enforces that order.
const api = (method, path, t) => request(app)[method](path).set(bearer(t));

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + 'talentledger';
  await mongoose.connect(process.env.MONGODB_URI);

  app = (await import('../app.js')).default;
  User = (await import('../models/User.js')).default;
  Training = (await import('../models/Training.js')).default;

  const mk = (name, email, role) =>
    User.create({ name, email, password: PW, role, organization: 'AuditOrg', district: 'Peshawar' });
  await mk('Admin', 'admin@test.pk', 'admin');
  await mk('Assessor', 'assessor@test.pk', 'assessor');
  await mk('Employer', 'employer@test.pk', 'employer');
  const workerUser = await mk('WorkerUser', 'worker@test.pk', 'worker');
  ids.workerUser = workerUser._id.toString();

  const training = await Training.create({
    title: 'Mason L2 Test', trade: 'mason', nqfLevel: 2, instructor: 'Inst', institution: 'AuditOrg',
    duration: '12 weeks', description: 'test', status: 'active',
    modules: [{ title: 'M1', description: 'd', type: 'reading', order: 1, content: '# hi' }],
    maxEnrollment: 50,
  });
  ids.training = training._id.toString();

  for (const [role, email] of [
    ['admin', 'admin@test.pk'], ['assessor', 'assessor@test.pk'],
    ['employer', 'employer@test.pk'], ['worker', 'worker@test.pk'],
  ]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
    tok[role] = res.body.accessToken;
  }
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

describe('Auth', () => {
  it('issues access tokens for every role', () => {
    for (const role of ['admin', 'assessor', 'employer', 'worker']) {
      expect(tok[role], `missing token for ${role}`).toBeTruthy();
    }
  });

  it('rejects bad credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@test.pk', password: 'wrong' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.accessToken).toBeFalsy();
  });
});

describe('Worker lifecycle', () => {
  it('creates a worker', async () => {
    const res = await api('post', '/api/v1/workers', tok.admin).send({
      fullName: 'Muhammad Irfan', cnic: '12345-1234567-1', trade: 'mason', district: 'Peshawar',
      user: ids.workerUser, email: 'worker@test.pk', gender: 'male', nqfLevel: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.registrationId).toMatch(/^TL-\d{4}-\d{5}$/);
    expect(res.body.cnicMasked).toBeTruthy();
    expect(res.body.cnicEncrypted, 'CNIC must not be stored in plaintext').not.toBe('12345-1234567-1');
    ids.worker = res.body._id;
  });

  it('reads worker detail, completeness, portfolio, work-permit', async () => {
    for (const sub of ['', '/completeness', '/portfolio', '/work-permit']) {
      const res = await api('get', `/api/v1/workers/${ids.worker}${sub}`, tok.admin);
      expect(res.status, `GET /workers/:id${sub}`).toBe(200);
    }
  });
});

describe('Venues & Jobs', () => {
  it('creates and reads a venue', async () => {
    const res = await api('post', '/api/v1/venues', tok.admin).send({
      name: 'PPMC Centre', address: 'Ring Rd', city: 'Peshawar', district: 'Peshawar',
      type: 'assessment-centre', capacity: 30,
    });
    expect(res.status).toBe(201);
    ids.venue = res.body._id;
    const get = await api('get', `/api/v1/venues/${ids.venue}`, tok.admin);
    expect(get.status).toBe(200);
  });

  it('lets an employer post a job and a worker apply', async () => {
    const job = await api('post', '/api/v1/jobs', tok.employer).send({
      title: 'Mason needed', description: 'Build walls in Dubai', trade: 'mason',
      location: { city: 'Dubai', country: 'UAE', isGulf: true }, positions: 5,
    });
    expect(job.status).toBe(201);
    ids.job = job.body._id;

    const apply = await api('post', `/api/v1/jobs/${ids.job}/apply`, tok.worker).send({ coverNote: 'Experienced mason' });
    expect(apply.status).toBe(201);
  });
});

describe('Training enrollment', () => {
  it('enrolls a worker into a training program', async () => {
    const res = await api('post', `/api/v1/training/${ids.training}/enroll`, tok.admin).send({ workerId: ids.worker });
    expect(res.status).toBe(201);
  });
});

describe('RPL Assessment', () => {
  it('creates an RPL assessment with pre-populated templates', async () => {
    const res = await api('post', '/api/v1/assessments', tok.assessor).send({
      worker: ids.worker, type: 'rpl', trade: 'mason', title: 'Mason RPL Assessment',
    });
    expect(res.status).toBe(201);
    expect(res.body.rpl).toBeTruthy();
    ids.assessment = res.body._id;
  });

  it('serves all assessment sub-resources', async () => {
    const subs = ['', '/timeline', '/fees', '/consent', '/scenarios', '/credential-tier',
      '/reassessment-eligibility', '/gap-training', '/portfolio-template', '/schedule'];
    for (const sub of subs) {
      const res = await api('get', `/api/v1/assessments/${ids.assessment}${sub}`, tok.assessor);
      expect(res.status, `GET /assessments/:id${sub}`).toBe(200);
    }
  });
});

describe('Credential issuance & verification', () => {
  it('issues a credential', async () => {
    const res = await api('post', '/api/v1/credentials', tok.admin).send({
      workerId: ids.worker, type: 'trade-certificate', title: 'Mason Trade Certificate',
      trade: 'mason', nqfLevel: 3, institution: 'PPMC',
    });
    expect(res.status).toBe(201);
    ids.credential = res.body._id;
    ids.credentialId = res.body.credentialId;
  });

  // Regression test for the vc.jwt schema bug:
  // the JWT-VC was generated but stripped on save because the schema lacked a `jwt` field.
  it('serves the signed JWT-VC (regression: vc.jwt must persist)', async () => {
    const res = await api('get', `/api/v1/credentials/${ids.credential}/vc`, tok.admin);
    expect(res.status, 'GET /credentials/:id/vc should return the JWT, not 404').toBe(200);
    expect(res.text.split('.')).toHaveLength(3); // header.payload.signature
  });

  it('serves the JSON-LD VC, PDF, card, MRA and blockchain status', async () => {
    const json = await api('get', `/api/v1/credentials/${ids.credential}/vc.json`, tok.admin);
    expect(json.status).toBe(200);
    expect(json.body.type).toContain('VerifiableCredential');

    for (const sub of ['/pdf', '/card', '/mra', '/blockchain']) {
      const res = await api('get', `/api/v1/credentials/${ids.credential}${sub}`, tok.admin);
      expect(res.status, `GET /credentials/:id${sub}`).toBe(200);
    }
  });

  it('verifies the credential publicly (no auth)', async () => {
    const res = await request(app).get(`/api/v1/verification/${ids.credentialId}`);
    expect(res.status).toBe(200);
  });
});

describe('Wallet', () => {
  it('generates a wallet credential and lists wallet data', async () => {
    const gen = await api('post', `/api/v1/credentials/${ids.credential}/wallet/generate`, tok.admin).send({});
    expect(gen.status).toBe(200);

    for (const path of ['/api/v1/wallet/portfolios', '/api/v1/wallet/shares', '/api/v1/wallet/blockchain-status']) {
      const res = await api('get', path, tok.worker);
      expect(res.status, `GET ${path}`).toBe(200);
    }
  });
});
