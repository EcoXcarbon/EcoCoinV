'use strict';
const express = require('express');
const path = require('node:path');
const { Store } = require('./lib/store');
const { Registry } = require('./lib/registry');
const { buildApi } = require('./routes/api');

function createApp(config, { dbFile } = {}) {
  const store = new Store(dbFile || config.dbFile);
  const registry = new Registry(store, config);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    const origin = req.get('origin');
    if (origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-Registry-Key');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1', buildApi(registry, config));
  app.get('/.well-known/did.json', (req, res) => res.json(registry.issuerDocument()));

  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { extensions: ['html'] }));
  // pretty routes for QR links and print views
  app.get('/verify/:nspId', (req, res) => res.sendFile(path.join(pub, 'verify.html')));
  app.get('/track/:nspId', (req, res) => res.sendFile(path.join(pub, 'track.html')));
  app.get('/card/:serial', (req, res) => res.sendFile(path.join(pub, 'card.html')));
  app.get('/certificate/:serial', (req, res) => res.sendFile(path.join(pub, 'certificate.html')));

  app.locals.store = store;
  app.locals.registry = registry;
  return app;
}

module.exports = { createApp };
