import { Router } from 'express';
import { body, query } from 'express-validator';
import { v4 as uuid } from 'uuid';
import XAPIStatement from '../models/XAPIStatement.js';
import { authenticate } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';

const router = Router();

/* ═══════════════════════════════════════════════════════════
   GAP 5: xAPI LRS ROUTES
   Built-in Learning Record Store (xAPI 1.0.3)
   ═══════════════════════════════════════════════════════════ */

// LRS version info
router.get('/about', (req, res) => {
  res.json({
    version: ['1.0.3'],
    extensions: { 'https://talentledger.ppmc.org.pk': 'TalentLedger Built-in LRS' },
  });
});

// Store one or more xAPI statements
router.post('/statements', authenticate, [
  body().custom(val => {
    if (Array.isArray(val)) return val.length > 0 && val.length <= 100;
    if (typeof val === 'object') return true;
    throw new Error('Must be a statement or array of statements');
  }),
  handleValidation,
], async (req, res, next) => {
  try {
    const statements = Array.isArray(req.body) ? req.body : [req.body];
    const ids = [];

    for (const stmt of statements) {
      const statement = {
        id: stmt.id || uuid(),
        actor: stmt.actor,
        verb: stmt.verb,
        object: stmt.object,
        result: stmt.result || undefined,
        context: stmt.context || undefined,
        timestamp: stmt.timestamp || new Date(),
        stored: new Date(),
        authority: stmt.authority || {
          mbox: `mailto:${req.user.email}`,
          name: req.user.name,
          objectType: 'Agent',
        },
      };

      await XAPIStatement.findOneAndUpdate(
        { id: statement.id },
        statement,
        { upsert: true, new: true },
      );
      ids.push(statement.id);
    }

    res.status(200).json(ids);
  } catch (err) { next(err); }
});

// Store single statement by ID
router.put('/statements', authenticate, [
  query('statementId').notEmpty(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { statementId } = req.query;
    const statement = {
      id: statementId,
      ...req.body,
      stored: new Date(),
      authority: req.body.authority || {
        mbox: `mailto:${req.user.email}`,
        name: req.user.name,
        objectType: 'Agent',
      },
    };

    await XAPIStatement.findOneAndUpdate(
      { id: statementId },
      statement,
      { upsert: true, new: true },
    );
    res.status(204).end();
  } catch (err) { next(err); }
});

// Query statements with xAPI filters
router.get('/statements', authenticate, async (req, res, next) => {
  try {
    const { agent, verb, activity, registration, since, until, limit = 100, ascending } = req.query;
    const filter = {};

    if (agent) {
      try {
        const agentObj = JSON.parse(agent);
        if (agentObj.mbox) filter['actor.mbox'] = agentObj.mbox;
      } catch {
        filter['actor.mbox'] = agent;
      }
    }
    if (verb) filter['verb.id'] = verb;
    if (activity) filter['object.id'] = activity;
    if (registration) filter['context.registration'] = registration;
    if (since) filter.timestamp = { ...filter.timestamp, $gt: new Date(since) };
    if (until) filter.timestamp = { ...filter.timestamp, $lt: new Date(until) };

    const sort = ascending === 'true' ? { timestamp: 1 } : { timestamp: -1 };
    const statements = await XAPIStatement.find(filter)
      .sort(sort)
      .limit(Math.min(Number(limit), 500))
      .lean();

    res.json({
      statements,
      more: '',
    });
  } catch (err) { next(err); }
});

// Activity state API — Get
router.get('/activities/state', authenticate, async (req, res, next) => {
  try {
    const { activityId, agent, stateId } = req.query;
    if (!activityId || !agent || !stateId) {
      return res.status(400).json({ error: 'activityId, agent, and stateId required' });
    }

    let agentMbox;
    try { agentMbox = JSON.parse(agent).mbox; } catch { agentMbox = agent; }

    const statement = await XAPIStatement.findOne({
      'object.id': `state:${activityId}:${stateId}`,
      'actor.mbox': agentMbox,
      'verb.id': 'http://adlnet.gov/expapi/verbs/state',
    }).sort({ stored: -1 }).lean();

    if (!statement) return res.status(404).json({ error: 'State not found' });
    res.json(statement.result || {});
  } catch (err) { next(err); }
});

// Activity state API — Put
router.put('/activities/state', authenticate, async (req, res, next) => {
  try {
    const { activityId, agent, stateId } = req.query;
    if (!activityId || !agent || !stateId) {
      return res.status(400).json({ error: 'activityId, agent, and stateId required' });
    }

    let agentMbox;
    try { agentMbox = JSON.parse(agent).mbox; } catch { agentMbox = agent; }

    await XAPIStatement.findOneAndUpdate(
      {
        'object.id': `state:${activityId}:${stateId}`,
        'actor.mbox': agentMbox,
        'verb.id': 'http://adlnet.gov/expapi/verbs/state',
      },
      {
        id: uuid(),
        actor: { mbox: agentMbox, objectType: 'Agent' },
        verb: { id: 'http://adlnet.gov/expapi/verbs/state', display: { 'en-US': 'state' } },
        object: { id: `state:${activityId}:${stateId}`, objectType: 'Activity' },
        result: req.body,
        stored: new Date(),
        timestamp: new Date(),
      },
      { upsert: true, new: true },
    );

    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
