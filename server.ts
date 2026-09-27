// Load .env before reading any process.env values.
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { OrchestratorError, DecypherOrchestrator } from './server/orchestrator';
import { RepoLoaderError, cloneRepo, extractZip, validateLocalPath } from './server/repoLoader';
import type { AgentKind, ConflictResolution } from '@decypher/core';

// Resolve everything from the working directory (npm scripts run from the repo root) so the
// same code works whether launched via `tsx server.ts` or the bundled `node dist/server.mjs`.
const projectDir = process.cwd();
const DIST_DIR = resolve(projectDir, 'dist');

const PORT = Number(process.env.PORT ?? 8787);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const AGENT: AgentKind = process.env.AGENT === 'bob' ? 'bob' : 'mock';
const DEFAULT_REPO = resolve(projectDir, 'sample-target');
const WORK_ROOT = join(projectDir, '.decypher-work');
const PREVIEW_ROOT = join(projectDir, '.decypher-preview');
const PREVIEW_PORTS = {
  before: Number(process.env.PREVIEW_PORT_BEFORE ?? 3001),
  after: Number(process.env.PREVIEW_PORT_AFTER ?? 3002),
};

const orchestrator = new DecypherOrchestrator(WORK_ROOT, PREVIEW_ROOT, PREVIEW_PORTS);

const app = express();
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json({ limit: '2mb' }));

/** multer instance — stores uploaded zips in memory (max 50 MB). */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/** Wrap async handlers so rejected promises hit the error middleware. */
const wrap =
  (fn: (req: express.Request, res: express.Response) => unknown) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const out = fn(req, res);
      if (out instanceof Promise) out.catch(next);
    } catch (err) {
      next(err);
    }
  };

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, agent: AGENT, defaultRepo: DEFAULT_REPO, preview: PREVIEW_PORTS });
});

/**
 * POST /api/repo/from-url   { source: string }
 * Accepts a GitHub URL or an absolute local folder path.
 * Returns { localPath } — the caller then opens a session with that path.
 */
app.post(
  '/api/repo/from-url',
  wrap(async (req, res) => {
    const source = String(req.body?.source ?? '').trim();
    if (!source) throw new OrchestratorError('A GitHub URL or local folder path is required.');

    let localPath: string;
    if (source.startsWith('git@') || source.startsWith('http://') || source.startsWith('https://')) {
      localPath = await cloneRepo(source);
    } else {
      localPath = validateLocalPath(source);
    }

    res.json({ localPath });
  }),
);

/**
 * POST /api/repo/from-zip   multipart/form-data  file: <zip>
 * Accepts a .zip archive of a project folder.
 * Returns { localPath } — the caller then opens a session with that path.
 */
app.post(
  '/api/repo/from-zip',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw new OrchestratorError('No file uploaded. Send a .zip archive.');
    if (!req.file.originalname.endsWith('.zip')) {
      throw new OrchestratorError('Only .zip archives are supported.');
    }
    const localPath = await extractZip(req.file.buffer, req.file.originalname);
    res.json({ localPath });
  }),
);

app.post(
  '/api/session',
  wrap((req, res) => {
    const repoRoot = typeof req.body?.repoRoot === 'string' && req.body.repoRoot.trim()
      ? resolve(req.body.repoRoot)
      : DEFAULT_REPO;
    const agent: AgentKind = req.body?.agent === 'bob' ? 'bob' : req.body?.agent === 'mock' ? 'mock' : AGENT;
    res.json(orchestrator.createSession(repoRoot, agent));
  }),
);

app.get(
  '/api/session/:id',
  wrap((req, res) => res.json(orchestrator.get(req.params.id))),
);

app.post(
  '/api/session/:id/chat',
  wrap(async (req, res) => {
    const message = String(req.body?.message ?? '').trim();
    if (!message) throw new OrchestratorError('A message is required.');
    res.json(await orchestrator.chat(req.params.id, message));
  }),
);

app.post(
  '/api/session/:id/compare-chat',
  wrap(async (req, res) => {
    const question = String(req.body?.question ?? '').trim();
    if (!question) throw new OrchestratorError('A question is required.');
    const path = typeof req.body?.path === 'string' && req.body.path.trim() ? req.body.path : undefined;
    res.json(await orchestrator.compareChat(req.params.id, question, path));
  }),
);

app.post(
  '/api/session/:id/plan',
  wrap(async (req, res) => {
    const request = String(req.body?.request ?? '').trim();
    if (!request) throw new OrchestratorError('A change request is required.');
    res.json(await orchestrator.plan(req.params.id, request));
  }),
);

app.post(
  '/api/session/:id/protect',
  wrap((req, res) => {
    const glob = String(req.body?.glob ?? '').trim();
    if (!glob) throw new OrchestratorError('A glob pattern is required.');
    res.json(orchestrator.addProtection(req.params.id, glob, req.body?.label));
  }),
);

app.post(
  '/api/session/:id/protect/toggle',
  wrap((req, res) => {
    const path = String(req.body?.path ?? '').trim();
    if (!path) throw new OrchestratorError('A file path is required.');
    res.json(orchestrator.togglePathProtection(req.params.id, path));
  }),
);

app.delete(
  '/api/session/:id/protect/:ruleId',
  wrap((req, res) => res.json(orchestrator.removeProtection(req.params.id, req.params.ruleId))),
);

app.post(
  '/api/session/:id/resolve',
  wrap((req, res) => {
    const resolution = String(req.body?.resolution ?? '') as ConflictResolution;
    if (!['allow', 'keep-and-replan', 'cancel'].includes(resolution)) {
      throw new OrchestratorError('Unknown resolution type.');
    }
    res.json(orchestrator.resolve(req.params.id, resolution));
  }),
);

app.post(
  '/api/session/:id/apply',
  wrap(async (req, res) => res.json(await orchestrator.apply(req.params.id))),
);

app.post(
  '/api/session/:id/revert',
  wrap((req, res) => res.json(orchestrator.revert(req.params.id))),
);

app.post(
  '/api/session/:id/preview/start',
  wrap(async (req, res) => res.json(await orchestrator.startPreview(req.params.id))),
);

app.post(
  '/api/session/:id/preview/stop',
  wrap((req, res) => {
    orchestrator.stopPreview(req.params.id);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/session/:id/file',
  wrap((req, res) => {
    const ref = req.query.ref === 'after' ? 'after' : 'before';
    const path = String(req.query.path ?? '');
    res.type('text/plain').send(orchestrator.fileContent(req.params.id, ref, path));
  }),
);

// ---- static web UI (single-origin deploy) --------------------------------
// When the Vite UI has been built (dist/index.html exists), serve it from this same
// server so the whole app is one origin — no CORS, and relative /api calls just work.
// This is what makes a single tunnel URL viable. In dev the UI runs on :5173 via a proxy.
const hasUi = existsSync(join(DIST_DIR, 'index.html'));
if (hasUi) {
  app.use(express.static(DIST_DIR));
  // SPA fallback: any non-API GET returns the app shell.
  app.get(/^(?!\/api$|\/api\/).*/, (_req, res) => {
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
}

// Error handler: OrchestratorError / RepoLoaderError -> 409, everything else -> 500.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof OrchestratorError || err instanceof RepoLoaderError) {
    res.status(409).json({ error: err.message });
    return;
  }
  console.error('[decypher] unhandled error:', err);
  res.status(500).json({ error: (err as Error)?.message ?? 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`Decypher orchestrator on http://localhost:${PORT}`);
  console.log(`  agent=${AGENT}  default repo=${DEFAULT_REPO}`);
  console.log(`  preview ports ${PREVIEW_PORTS.before} (before) / ${PREVIEW_PORTS.after} (after)`);
  console.log(hasUi ? `  serving web UI from ${DIST_DIR}` : '  web UI not built (run `npm run build` to serve it here)');
  console.log(`  allowing web origin ${WEB_ORIGIN}`);
});

// Don't leave preview servers running when the orchestrator exits.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    orchestrator.stopAllPreviews();
    process.exit(0);
  });
}
