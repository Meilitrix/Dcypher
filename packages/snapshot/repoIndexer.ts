import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { FileNode, RepoIndex } from '@decypher/core';

const IGNORED = new Set(['node_modules', '.git', '.decypher-work', 'dist', '.next', 'build']);

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function walk(dir: string, root: string, acc: FileNode[]): void {
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue;
    const abs = join(dir, entry);
    const rel = toPosix(relative(root, abs));
    const st = statSync(abs);
    if (st.isDirectory()) {
      acc.push({ path: rel, type: 'dir' });
      walk(abs, root, acc);
    } else {
      acc.push({ path: rel, type: 'file', size: st.size });
    }
  }
}

/** Build a lightweight RepoIndex (file tree) for a directory. No parsing, just structure. */
export function indexRepo(repoRoot: string): RepoIndex {
  const files: FileNode[] = [];
  walk(repoRoot, repoRoot, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const filePaths = files.filter((f) => f.type === 'file').map((f) => f.path);
  return { repoRoot, files, filePaths };
}
