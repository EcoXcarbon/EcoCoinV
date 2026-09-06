import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

/**
 * Google-Classroom-style LMS features: managed Topics/outline, scheduled Live
 * sessions, and link/video teaching resources. Boots the real app on in-memory Mongo.
 */

const PW = 'Test@2026aa';
let mongod, app, User;
const tok = {};
const ids = {};
const bearer = (t) => (t ? { Authorization: `Bearer ${t}` } : {});
const api = (method, path, t) => request(app)[method](path).set(bearer(t));

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri() + 'talentledger';
  await mongoose.connect(process.env.MONGODB_URI);
  app = (await import('../app.js')).default;
  User = (await import('../models/User.js')).default;

  const mk = (name, email, role) =>
    User.create({ name, email, password: PW, role, organization: 'AuditOrg', district: 'Peshawar', emailVerified: true });
  await mk('Teacher', 'teacher@test.pk', 'institution');
  await mk('Student', 'student@test.pk', 'worker');

  for (const [k, e] of [['teacher', 'teacher@test.pk'], ['student', 'student@test.pk']]) {
    const r = await request(app).post('/api/v1/auth/login').send({ email: e, password: PW });
    tok[k] = r.body.accessToken;
  }

  // Teacher creates a class; student joins by code.
  const cls = await api('post', '/api/v1/classroom', tok.teacher).send({ name: 'Masonry 101', subject: 'Construction' });
  ids.class = cls.body._id;
  ids.joinCode = cls.body.joinCode;
  await api('post', '/api/v1/classroom/join', tok.student).send({ code: ids.joinCode });
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

describe('Managed Topics / Outline', () => {
  it('creates topics and lists them in order', async () => {
    const t1 = await api('post', `/api/v1/classroom/${ids.class}/topics`, tok.teacher).send({ title: 'Week 1 — Foundations' });
    const t2 = await api('post', `/api/v1/classroom/${ids.class}/topics`, tok.teacher).send({ title: 'Week 2 — Bricklaying' });
    expect(t1.status).toBe(201);
    expect(t2.status).toBe(201);
    ids.topic1 = t1.body._id;
    ids.topic2 = t2.body._id;

    const list = await api('get', `/api/v1/classroom/${ids.class}/topics`, tok.student);
    expect(list.status).toBe(200);
    expect(list.body.map(t => t._id)).toEqual([ids.topic1, ids.topic2]);
  });

  it('reorders topics', async () => {
    const res = await api('put', `/api/v1/classroom/${ids.class}/topics/reorder`, tok.teacher)
      .send({ order: [ids.topic2, ids.topic1] });
    expect(res.status).toBe(200);
    expect(res.body.map(t => t._id)).toEqual([ids.topic2, ids.topic1]);
  });

  it('renames a topic', async () => {
    const res = await api('put', `/api/v1/classroom/${ids.class}/topics/${ids.topic1}`, tok.teacher)
      .send({ title: 'Week 1 — Safety & Foundations' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Week 1 — Safety & Foundations');
  });

  it('blocks students from managing topics', async () => {
    const res = await api('post', `/api/v1/classroom/${ids.class}/topics`, tok.student).send({ title: 'Hacky topic' });
    expect(res.status).toBe(403);
  });
});

describe('Teaching resources (materials with links/files)', () => {
  it('posts a material with a link resource under a topic', async () => {
    const res = await api('post', `/api/v1/classroom/${ids.class}/classwork`, tok.teacher).send({
      title: 'Bricklaying handbook', type: 'material', topicId: ids.topic2,
      attachments: [
        { kind: 'link', name: 'NAVTTC handbook', url: 'https://navttc.gov.pk/handbook' },
        { kind: 'video', name: 'Demo video', url: 'https://youtube.com/watch?v=abc' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('material');
    expect(res.body.topicId).toBe(ids.topic2);
    expect(res.body.attachments).toHaveLength(2);
    ids.material = res.body._id;
  });

  it('posts an assignment under a topic and reorders classwork', async () => {
    const a = await api('post', `/api/v1/classroom/${ids.class}/classwork`, tok.teacher).send({
      title: 'Lay a test wall', type: 'assignment', topicId: ids.topic2, points: 50,
    });
    expect(a.status).toBe(201);
    ids.assignment = a.body._id;

    const reorder = await api('put', `/api/v1/classroom/${ids.class}/classwork/reorder`, tok.teacher).send({
      items: [
        { id: ids.assignment, order: 0, topicId: ids.topic2 },
        { id: ids.material, order: 1, topicId: ids.topic2 },
      ],
    });
    expect(reorder.status).toBe(200);
  });

  it('orphans classwork to "no topic" when its topic is deleted', async () => {
    const del = await api('delete', `/api/v1/classroom/${ids.class}/topics/${ids.topic2}`, tok.teacher);
    expect(del.status).toBe(200);
    const work = await api('get', `/api/v1/classroom/${ids.class}/classwork`, tok.teacher);
    const mat = work.body.find(w => w._id === ids.material);
    expect(mat.topicId == null).toBe(true); // moved to ungrouped, not deleted
  });
});

describe('Scheduled Live Sessions', () => {
  it('schedules a jitsi session with an auto-generated private room', async () => {
    const res = await api('post', `/api/v1/classroom/${ids.class}/live`, tok.teacher).send({
      title: 'Live: bricklaying demo', scheduledFor: '2026-07-01T10:00:00.000Z', durationMins: 90, mode: 'jitsi',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.jitsiRoom).toMatch(/^tl-live-/);
    ids.session = res.body._id;
  });

  it('requires a meetingUrl for link mode', async () => {
    const res = await api('post', `/api/v1/classroom/${ids.class}/live`, tok.teacher).send({
      title: 'Bad link session', scheduledFor: '2026-07-02T10:00:00.000Z', mode: 'link',
    });
    expect(res.status).toBe(400);
  });

  it('goes live then ends with a recording link', async () => {
    const start = await api('post', `/api/v1/classroom/${ids.class}/live/${ids.session}/start`, tok.teacher);
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('live');
    expect(start.body.startedAt).toBeTruthy();

    const end = await api('post', `/api/v1/classroom/${ids.class}/live/${ids.session}/end`, tok.teacher)
      .send({ recordingUrl: 'https://drive.google.com/rec/123' });
    expect(end.status).toBe(200);
    expect(end.body.status).toBe('ended');
    expect(end.body.recordingUrl).toBe('https://drive.google.com/rec/123');
  });

  it('lets a student list sessions but not create them', async () => {
    const list = await api('get', `/api/v1/classroom/${ids.class}/live`, tok.student);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);

    const create = await api('post', `/api/v1/classroom/${ids.class}/live`, tok.student).send({
      title: 'Nope', scheduledFor: '2026-07-03T10:00:00.000Z',
    });
    expect(create.status).toBe(403);
  });

  it('deletes a session', async () => {
    const res = await api('delete', `/api/v1/classroom/${ids.class}/live/${ids.session}`, tok.teacher);
    expect(res.status).toBe(200);
  });
});
