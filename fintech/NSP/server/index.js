'use strict';
const config = require('./config');
const { createApp } = require('./app');

const app = createApp(config);
app.listen(config.port, config.host, () => {
  console.log(`NSP Registry listening on http://${config.host}:${config.port}  (public URL ${config.publicUrl})`);
  console.log(`Issuer: ${config.issuer.name} [${config.issuer.country}] — card validity ${config.cardValidityYears}y`);
  if (config.registryKeys.has('dev-registrar-key')) console.warn('WARNING: using default dev registrar key — set NSP_REGISTRY_KEYS in production');
});
