/**
 * A tiny zero-dependency glob matcher, enough for the common protection-rule syntax:
 *   - `**` matches any number of path segments (including none)
 *   - `*`  matches any characters within a single segment (not across `/`)
 *   - `?`  matches a single character within a segment
 *   - `{a,b}` brace alternation
 * Everything else is treated literally. Paths use forward slashes.
 */

function escapeRegExp(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/** Compile a glob pattern into an anchored regular expression source. */
export function globToRegExpSource(pattern: string): string {
  const src = pattern.replace(/\\/g, '/');
  let out = '^';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '*') {
      const next = src[i + 1];
      if (next === '*') {
        // `**` may be followed by `/`; consume it so it can also match zero segments.
        const after = src[i + 2];
        if (after === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{') {
      const close = src.indexOf('}', i);
      if (close === -1) {
        out += escapeRegExp(ch);
      } else {
        const options = src.slice(i + 1, close).split(',');
        out += `(?:${options.map((o) => o.split('').map(escapeRegExp).join('')).join('|')})`;
        i = close;
      }
    } else {
      out += escapeRegExp(ch);
    }
  }
  out += '$';
  return out;
}

const cache = new Map<string, RegExp>();

/** Whether a single relative path matches the given glob pattern. */
export function matchGlob(pattern: string, relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  let re = cache.get(pattern);
  if (!re) {
    re = new RegExp(globToRegExpSource(pattern));
    cache.set(pattern, re);
  }
  return re.test(norm);
}
