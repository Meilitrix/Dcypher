/**
 * server/repoLoader.ts
 *
 * Accepts three kinds of "repo source" and resolves them to a local folder path:
 *   1. GitHub / Git URL  → cloned into a temp folder using simple-git
 *   2. Local folder path → validated (must exist, must be a directory, must be safe)
 *   3. Uploaded zip file → extracted into a temp folder using the built-in unzip
 *
 * Returns the absolute local path to the repo root on success.
 * Throws OrchestratorError on any validation or clone failure.
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { simpleGit } from 'simple-git';

/** Raised for user-facing failures (mapped to HTTP 409 by the server error handler). */
export class RepoLoaderError extends Error {}

// ── Safety ───────────────────────────────────────────────────────────────────

const SAFE_ROOTS = [homedir(), tmpdir(), resolve(process.cwd())];

/** Block paths that escape the user's home dir, tmp dir, or project dir. */
function assertSafePath(p: string): void {
  const abs = resolve(p);
  const ok = SAFE_ROOTS.some((root) => abs.startsWith(root));
  if (!ok) {
    throw new RepoLoaderError(
      `Path "${p}" is outside allowed directories. Use a path inside your home folder or a GitHub URL.`,
    );
  }
}

// ── Temp directory helpers ────────────────────────────────────────────────────

let _counter = 0;
function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `decypher-${label}-${Date.now()}-${++_counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── URL → clone ───────────────────────────────────────────────────────────────

/**
 * Clone a GitHub (or any public Git) URL into a fresh temp directory.
 * Only HTTPS and SSH git URLs are accepted — arbitrary http(s) URLs that aren't
 * git repos are rejected early.
 */
export async function cloneRepo(url: string): Promise<string> {
  const trimmed = url.trim();

  // Accept git@ SSH URLs and https:// URLs that look like git repos.
  const isGitUrl =
    trimmed.startsWith('git@') ||
    /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org|.*\.git$)/i.test(trimmed) ||
    trimmed.endsWith('.git');

  if (!isGitUrl) {
    throw new RepoLoaderError(
      `"${trimmed}" doesn't look like a Git URL. Use a GitHub URL (https://github.com/...) or a local folder path.`,
    );
  }

  // Derive a readable folder name from the repo slug.
  const slug = trimmed.replace(/\.git$/, '').split('/').pop() ?? 'repo';
  const dest = makeTempDir(slug);

  try {
    const git = simpleGit();
    await git.clone(trimmed, dest, ['--depth=1']);
  } catch (err) {
    throw new RepoLoaderError(
      `Could not clone "${trimmed}": ${(err as Error).message.split('\n')[0]}`,
    );
  }

  return dest;
}

// ── Local path → validate ────────────────────────────────────────────────────

/** Verify a local folder path is readable and safe. Returns the resolved absolute path. */
export function validateLocalPath(input: string): string {
  const abs = resolve(input.trim());
  assertSafePath(abs);

  if (!existsSync(abs)) {
    throw new RepoLoaderError(`Folder not found: "${abs}"`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new RepoLoaderError(`"${abs}" is a file, not a folder. Point to the project's root folder.`);
  }
  if (readdirSync(abs).length === 0) {
    throw new RepoLoaderError(`Folder "${abs}" is empty.`);
  }

  return abs;
}

// ── Uploaded zip → extract ────────────────────────────────────────────────────

/**
 * Save a multer-provided zip file buffer into a temp folder, extract it,
 * and return the path to the extracted repo root.
 *
 * The unzip is done via the system `unzip` (Linux/macOS) or PowerShell's
 * Expand-Archive (Windows). Falls back gracefully with a clear error message.
 */
export async function extractZip(
  buffer: Buffer,
  originalName: string,
): Promise<string> {
  const safe = basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dest = makeTempDir('zip');
  const zipPath = join(dest, safe.endsWith('.zip') ? safe : `${safe}.zip`);
  const extractDir = join(dest, 'extracted');
  mkdirSync(extractDir, { recursive: true });

  // Write the uploaded buffer to disk.
  await pipeline(
    (async function* () { yield buffer; })(),
    createWriteStream(zipPath),
  );

  // Extract using the best available tool.
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
      ], { stdio: 'pipe' });
    } else {
      execFileSync('unzip', ['-q', zipPath, '-d', extractDir], { stdio: 'pipe' });
    }
  } catch (err) {
    throw new RepoLoaderError(
      `Could not unzip the file: ${(err as Error).message.split('\n')[0]}. Make sure the file is a valid .zip archive.`,
    );
  }

  // If the zip contained a single top-level folder, use that as the root.
  const entries = readdirSync(extractDir);
  if (entries.length === 1) {
    const sub = join(extractDir, entries[0]);
    if (statSync(sub).isDirectory()) return sub;
  }

  return extractDir;
}
