import type { ProtectedRule, RepoIndex } from '@decypher/core';
import { matchGlob } from '@decypher/protect';

interface Props {
  index: RepoIndex;
  rules: ProtectedRule[];
  /** Paths the current plan intends to change — shown with an amber dot. */
  plannedPaths: string[];
  onTogglePath: (path: string) => void;
  /** Called when the user clicks a filename (not the lock icon) to view its content. */
  onOpenFile: (path: string) => void;
}

/** Groups file paths by their first directory segment. */
function groupByDir(paths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const slash = p.indexOf('/');
    const dir = slash === -1 ? '' : p.slice(0, slash);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(p);
  }
  return groups;
}

/**
 * Full-sidebar file tree. Every repo file is listed, grouped by top-level directory.
 * Each row has a lock toggle; planned files get an amber indicator dot.
 */
export function FileTree({ index, rules, plannedPaths, onTogglePath, onOpenFile }: Props) {
  const files = index.files.filter((f) => f.type === 'file');
  const isLocked = (path: string) => rules.some((r) => r.locked && matchGlob(r.glob, path));
  const groups = groupByDir(files.map((f) => f.path));

  return (
    <div className="filetree">
      {Array.from(groups.entries()).map(([dir, paths]) => (
        <div key={dir || '__root__'} className="ft-group">
          {dir && <div className="ft-dir">{dir}/</div>}
          {paths.map((path) => {
            const locked = isLocked(path);
            const planned = plannedPaths.includes(path);
            const name = dir ? path.slice(dir.length + 1) : path;
            return (
              <div key={path} className={`ft-row${planned ? ' planned' : ''}${locked ? ' locked' : ''}`}>
                <button
                  type="button"
                  className={`ft-lock${locked ? ' on' : ''}`}
                  onClick={() => onTogglePath(path)}
                  title={locked ? 'Unlock this file' : 'Lock this file'}
                >
                  {locked ? '🔒' : '🔓'}
                </button>
                <button
                  type="button"
                  className="ft-name-btn"
                  title={`Open ${path}`}
                  onClick={() => onOpenFile(path)}
                >
                  {name}
                </button>
                {planned && <span className="ft-dot" title="Planned for change" />}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
