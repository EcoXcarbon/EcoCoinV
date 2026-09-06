// Boot the Express app WITHOUT connecting to MongoDB, just to verify route wiring.
// Probes the new /api/classroom endpoints to confirm they are reachable.
//
// Run from server dir: node src/scripts/_classroom-route-check.js
import http from 'http';
import app from '../app.js';

const PORT = 5099;

function probe(path, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 300) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const server = app.listen(PORT, async () => {
  const tests = [
    // CSRF endpoint should respond 200 OK without auth
    { name: 'csrf-token', call: () => probe('/api/csrf-token') },
    // All classroom routes require auth → expect 401 (route exists)
    { name: 'GET /api/classroom (no auth)', call: () => probe('/api/classroom') },
    { name: 'POST /api/classroom/join (no auth)', call: () => probe('/api/classroom/join', 'POST') },
    { name: 'GET /api/classroom/507f1f77bcf86cd799439011', call: () => probe('/api/classroom/507f1f77bcf86cd799439011') },
    { name: 'GET /api/classroom/507f1f77bcf86cd799439011/people', call: () => probe('/api/classroom/507f1f77bcf86cd799439011/people') },
    { name: 'GET /api/classroom/507f1f77bcf86cd799439011/stream', call: () => probe('/api/classroom/507f1f77bcf86cd799439011/stream') },
    { name: 'GET /api/classroom/507f1f77bcf86cd799439011/classwork', call: () => probe('/api/classroom/507f1f77bcf86cd799439011/classwork') },
    { name: 'GET /api/classroom/507f1f77bcf86cd799439011/classwork/gradebook/all', call: () => probe('/api/classroom/507f1f77bcf86cd799439011/classwork/gradebook/all') },
  ];

  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      const r = await t.call();
      // Routes that exist should NOT return 404. csrf is 200; others should be 401 (auth required).
      // 200 for csrf; 401 (no auth) or 403 (CSRF check fired before auth on POSTs) both confirm
      // the route is wired. 404 would be the only failure mode for a missing route.
      const expectedSet = t.name === 'csrf-token' ? [200] : [401, 403];
      const ok = expectedSet.includes(r.status);
      console.log(`${ok ? 'PASS' : 'FAIL'} [${r.status}] ${t.name}`);
      if (!ok) console.log(`     body: ${r.body}`);
      if (ok) pass++; else fail++;
    } catch (err) {
      console.log(`ERROR ${t.name}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n=== ${pass}/${pass + fail} passed ===`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
});
