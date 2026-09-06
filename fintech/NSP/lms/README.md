# NSP Learning — the LMS

The TalentLedger learning platform, copied from the running `tl.ppmc.pk` and set
up **inside NSP as a separate tool**: same code, same layout, same behaviour,
its own database, its own secrets, its own containers.

Live at **https://nsp.ppmc.pk/lms/**

## Why it is a separate application

The registry is Node's built-in SQLite with two dependencies and no build step.
The LMS is MongoDB, Express, Mongoose, React and Vite with about thirty. Folding
one into the other would have meant rewriting twenty thousand lines — which is
the opposite of copying the code and the format across. So it runs as its own
service and shares exactly one thing with the registry: the hostname.

It shares **no data**. Separate MongoDB, separate JWT and encryption keys,
separate user accounts. A token minted by the registry means nothing here, and
a token minted here means nothing at `tl.ppmc.pk` — deliberately, so the two
deployments cannot be made to trust each other by accident.

## Source

Taken from `/opt/talentledger` **on the VPS**, not from the git remote. The
production box carries uncommitted work on exactly the files the LMS is made of
(`routes/training.js`, `pages/ClassView.jsx`, `services/aiService.js`,
`app.js`), so the remote is behind what is actually running and a copy from it
would have been a copy of the wrong thing.

## What changed from the original

Almost nothing, and only where it had to. The registry already answers on
`/api/v1` at this hostname, so the LMS could not keep absolute `/api` paths:

| Change | Where |
|---|---|
| `/api` → `/lms/api`, `/uploads` → `/lms/uploads` | 18 client files, 26 references |
| `basename="/lms"` | `client/src/main.jsx` |
| `base: '/lms/'`, service-worker scope, dev proxy | `client/vite.config.js` |
| Port 5003 → 5010, container user renamed | `server/Dockerfile` |
| Own database, own secrets, ports on localhost | `docker-compose.yml` |

Everything else — models, routes, services, components, styling, seed data,
question banks — is byte-for-byte what runs on `tl.ppmc.pk`.

The container's own nginx is **unmodified apart from the upstream port**. The
registry's vhost strips the `/lms` prefix before proxying, so inside the
container the app sits at the root exactly as it does on TalentLedger. Only the
browser sees `/lms/...`, because the bundle is built with `base=/lms/`.

## Deploying

```powershell
# from the repo root — installs the /lms nginx location
.\fintech\NSP\deploy\deploy-from-windows.ps1     -Key E:\.env-vault\vps\talentledger-vps
# then the tool itself (builds images on the VPS; several minutes)
.\fintech\NSP\deploy\deploy-lms-from-windows.ps1 -Key E:\.env-vault\vps\talentledger-vps
```

`-NoBuild` skips the image build when only configuration changed. The registry's
own deploy excludes `lms/` — the two are deployed separately and land in
different directories (`/opt/nsp` and `/opt/nsp-lms`).

Secrets are generated on the VPS on first install and then left alone, so a
redeploy never invalidates every learner's session or makes encrypted fields
unreadable. `.env` (compose) and `server/.env` (application) are never uploaded.

## Configuration

`server/.env.example` documents every setting. Three are required and the server
refuses to start in production without them: `JWT_SECRET`, `JWT_REFRESH_SECRET`,
`ENCRYPTION_KEY`. The installer generates all three.

Optional integrations degrade rather than fail: without `ANTHROPIC_API_KEY` or a
relay the AI marking is off; without a JaaS tenant live classes fall back to
public `meet.jit.si`, where nobody can start a meeting and learners sit at
"waiting for moderator"; `BLOCKCHAIN_CHAIN=simulated` does **not** anchor
anything on a chain.

## Operating

```bash
cd /opt/nsp-lms
docker compose ps
docker compose logs -f server
docker compose restart server
docker compose exec mongo mongosh -u nsp_lms -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin nsp_lms
```

The database starts empty. `server/src/seed.js` populates a demo estate
(courses, classes, question banks, sample learners) — run it deliberately, and
never against real data.
