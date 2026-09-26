// Tiny HTTP server for the sample target. Serves the web/ static files and a
// small JSON API over the task store. No external dependencies on purpose.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { listTasks, addTask, toggleTask } from './store.js';

const root = fileURLToPath(new URL('../web', import.meta.url));
const port = Number(process.env.PORT ?? 4000);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(listTasks()));
    return;
  }

  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const body = await readBody(req);
    const task = addTask(body.title ?? 'Untitled');
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify(task));
    return;
  }

  if (url.pathname.startsWith('/api/tasks/') && req.method === 'PATCH') {
    const id = url.pathname.split('/').pop();
    const task = toggleTask(id);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(task));
    return;
  }

  await serveStatic(url.pathname, res);
});

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const file = join(root, rel);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

server.listen(port, () => {
  console.log(`Tiny Inbox running at http://localhost:${port}`);
});
