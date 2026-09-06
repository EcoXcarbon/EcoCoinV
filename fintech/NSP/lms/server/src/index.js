import connectDB from './config/db.js';
import env from './config/env.js';
import app from './app.js';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve client in production
if (env.isProd) {
  app.use(express.static(path.join(__dirname, '../../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

// Start
connectDB().then(() => {
  app.listen(env.PORT, () => {
    console.log(`NSP Learning API v1 running on port ${env.PORT} [${env.NODE_ENV}]`);
  });
});

export default app;
