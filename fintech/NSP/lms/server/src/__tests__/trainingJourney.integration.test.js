import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

/**
 * End-to-end test for the unified Training journey (LMS "Training" tab):
 *   enrol → pre-assessment → materials → live session → final assessment →
 *   certificate (gated on passing the final assessment, signed by the Chief
 *   Master Trainer). Boots the real app against in-memory MongoDB.
 */

const PW = 'Test@2026aa';
let mongod, app, User, Training, Worker;
const tok = {};
const ids = {};

const bearer = (t) => (t ? { Authorization: `Bearer ${t}` } : {});
const api = (method, path, t) => request(app)[method](path).set(bearer(t));

const MCQ = (question, options, correctOption) => ({ question, type: 'mcq', options, correctOption, points: 1 });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + 'talentledger-journey';
  await mongoose.connect(process.env.MONGODB_URI);

  app = (await import('../app.js')).default;
  User = (await import('../models/User.js')).default;
  Training = (await import('../models/Training.js')).default;
  Worker = (await import('../models/Worker.js')).default;

  const admin = await User.create({ name: 'Admin', email: 'admin@j.pk', password: PW, role: 'admin' });
  const workerUser = await User.create({ name: 'Learner', email: 'learner@j.pk', password: PW, role: 'worker' });

  const worker = await Worker.create({
    user: workerUser._id, fullName: 'Ali Hassan', registrationId: 'TL-2026-90001',
    cnicEncrypted: 'enc', cnicMasked: '*****-*****4-1', trade: 'electrician', district: 'Peshawar',
  });
  ids.worker = worker._id.toString();

  const training = await Training.create({
    title: 'Electrical Safety Level 3', trade: 'electrician', nqfLevel: 3,
    institution: 'PPMC KP', instructor: 'Eng. Kamal', duration: '6 weeks', status: 'active',
    passMark: 70,
    signatory: { name: 'Dr. Ayesha Khan', title: 'Chief Master Trainer' },
    modules: [
      { title: 'Pre-Assessment', type: 'quiz', order: 1, isPreAssessment: true,
        quizQuestions: [MCQ('Is water a conductor?', ['Yes', 'No'], 0), MCQ('Volts unit?', ['Ampere', 'Volt'], 1)] },
      { title: 'Safety Fundamentals', type: 'reading', order: 2, content: '# Safety\nAlways isolate power.' },
      { title: 'Final Assessment', type: 'quiz', order: 3, isFinalAssessment: true,
        quizQuestions: [MCQ('Wear PPE?', ['No', 'Yes'], 1), MCQ('Earthing protects?', ['Yes', 'No'], 0)] },
    ],
  });
  ids.training = training._id.toString();
  ids.pre = training.modules[0]._id.toString();
  ids.reading = training.modules[1]._id.toString();
  ids.final = training.modules[2]._id.toString();

  for (const [role, email] of [['admin', 'admin@j.pk'], ['worker', 'learner@j.pk']]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
    tok[role] = res.body.accessToken;
  }
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

describe('Training journey', () => {
  it('enrols the worker', async () => {
    const res = await api('post', `/api/v1/training/${ids.training}/enroll`, tok.admin).send({ workerId: ids.worker });
    expect(res.status).toBe(201);
  });

  it('passes the pre-assessment (quiz module)', async () => {
    const res = await api('post', `/api/v1/training/${ids.training}/quiz/${ids.pre}`, tok.worker)
      .send({ workerId: ids.worker, answers: [{ selectedOption: 0 }, { selectedOption: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(true);
  });

  it('completes the training material', async () => {
    const res = await api('put', `/api/v1/training/${ids.training}/progress`, tok.worker)
      .send({ workerId: ids.worker, moduleId: ids.reading });
    expect(res.status).toBe(200);
  });

  it('does NOT issue a certificate before the final assessment is passed', async () => {
    const res = await api('get', `/api/v1/training/${ids.training}/certificate`, tok.worker);
    expect(res.status).toBe(200);
    expect(res.body.issued).toBe(false);
  });

  it('schedules and lists a training-scoped live session', async () => {
    const create = await api('post', `/api/v1/training/${ids.training}/live`, tok.admin).send({
      title: 'Live Q&A', scheduledFor: new Date(Date.now() + 3600_000).toISOString(), durationMins: 45, mode: 'jitsi',
    });
    expect(create.status).toBe(201);
    ids.session = create.body._id;

    const list = await api('get', `/api/v1/training/${ids.training}/live`, tok.worker);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    const token = await api('get', `/api/v1/training/${ids.training}/live/${ids.session}/token`, tok.worker);
    expect(token.status).toBe(200);
    expect(token.body.room).toBeTruthy(); // JaaS unconfigured in test → fallback room still returned
  });

  it('passes the final assessment and auto-issues the certificate', async () => {
    const res = await api('post', `/api/v1/training/${ids.training}/quiz/${ids.final}`, tok.worker)
      .send({ workerId: ids.worker, answers: [{ selectedOption: 1 }, { selectedOption: 0 }] });
    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(true);
  });

  it('exposes the issued certificate with the Chief Master Trainer signatory', async () => {
    const res = await api('get', `/api/v1/training/${ids.training}/certificate`, tok.worker);
    expect(res.status).toBe(200);
    expect(res.body.issued).toBe(true);
    expect(res.body.title).toContain('Electrical Safety Level 3');
    expect(res.body.holderName).toBe('Ali Hassan');
    expect(res.body.signatory.title).toBe('Chief Master Trainer');
    expect(res.body.signatory.name).toBe('Dr. Ayesha Khan');
    ids.certId = res.body.certificateId;
  });

  it('streams the designed certificate PDF', async () => {
    const res = await api('get', `/api/v1/training/${ids.training}/certificate/pdf`, tok.worker).buffer();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    // PDF magic bytes
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  it('lets staff type/edit the certificate signatory (open field)', async () => {
    const upd = await api('put', `/api/v1/training/${ids.training}`, tok.admin)
      .send({ signatory: { name: 'Prof. Bilal Ahmed', title: 'Chief Master Trainer' } });
    expect(upd.status).toBe(200);
    expect(upd.body.signatory.name).toBe('Prof. Bilal Ahmed');

    const get = await api('get', `/api/v1/training/${ids.training}`, tok.admin);
    expect(get.body.signatory.name).toBe('Prof. Bilal Ahmed');
    expect(get.body.signatory.title).toBe('Chief Master Trainer');
  });

  it('blocks non-staff from editing the signatory', async () => {
    const res = await api('put', `/api/v1/training/${ids.training}`, tok.worker)
      .send({ signatory: { name: 'Hacker' } });
    expect(res.status).toBe(403);
  });
});
