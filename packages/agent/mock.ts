import type { ChangePlan, FileDiff, PlannedFileChange, RepoIndex } from '@decypher/core';
import { newId } from '@decypher/core';
import type { FileMap } from '@decypher/diff';
import type { AgentAdapter, ChatReply, ConversationTurn, PlannedWrites, PlanResult } from './adapter';

/** A canned scenario: how to describe the plan + how to transform the current files. */
interface Scenario {
  match: RegExp;
  summary: string;
  /** Plain-English chat narrative for the plan stage. */
  planNarrative: string;
  /**
   * Plain-English chat narrative for the diff stage.
   * Receives the list of paths that actually changed so it can be specific.
   */
  diffNarrative: (changedPaths: string[]) => string;
  files: PlannedFileChange[];
  writes: (files: FileMap) => PlannedWrites;
}

/** Replace `from` with `to` only if present, so transforms degrade gracefully on other repos. */
function edit(content: string, from: string, to: string): string {
  return content.includes(from) ? content.replace(from, to) : content;
}

const SCENARIOS: Scenario[] = [
  {
    match: /(due|deadline|date)/i,
    summary: 'Add an optional due date to tasks and surface it in the list.',
    planNarrative:
      'I\'ll add an optional due-date field to the task data model and show it next to each task title. ' +
      'Three files are involved: the store (data shape + seed data), a new date-formatting helper, ' +
      'and the front-end render layer that displays tasks.',
    diffNarrative: (paths) =>
      `The changes landed across ${paths.length} file(s): ${paths.join(', ')}. ` +
      'The store now initialises tasks with a dueDate field and accepts it when adding new tasks. ' +
      'A new dates.js helper formats the value for display. ' +
      'The task list renders "- due <date>" next to any task that has a due date set.',
    files: [
      {
        path: 'src/store.js',
        action: 'modify',
        description: 'Defines the task list and the functions that read and update it.',
        purpose: 'Core data model: give tasks a `dueDate` field and accept it when adding.',
        dependsOn: [],
      },
      {
        path: 'src/util/dates.js',
        action: 'create',
        description: 'Small formatting utilities for working with dates.',
        purpose: 'New helper that formats a due date for display.',
        dependsOn: [],
      },
      {
        path: 'web/app.js',
        action: 'modify',
        description: 'Fetches tasks from the API and renders them into the page.',
        purpose: 'Render layer: show the due date next to each task title.',
        dependsOn: ['src/store.js'],
      },
    ],
    writes: (files) => ({
      'src/store.js': edit(
        edit(
          files['src/store.js'] ?? '',
          "export function addTask(title) {\n  const task = { id: idCounter++, title, done: false };",
          "export function addTask(title, dueDate = null) {\n  const task = { id: idCounter++, title, done: false, dueDate };",
        ),
        "  { id: 1, title: 'Review pull request #482', done: false },",
        "  { id: 1, title: 'Review pull request #482', done: false, dueDate: '2026-09-30' },",
      ),
      'src/util/dates.js':
        '// Formatting helpers for task due dates.\nexport function formatDue(dueDate) {\n  if (!dueDate) return null;\n  return new Date(dueDate).toLocaleDateString();\n}\n',
      'web/app.js': edit(
        files['web/app.js'] ?? '',
        '    li.textContent = task.title;',
        "    li.textContent = task.dueDate ? `${task.title} - due ${task.dueDate}` : task.title;",
      ),
    }),
  },
  {
    match: /(theme|style|colou?r|visual|dark)/i,
    summary: 'Refresh the visual theme of the inbox.',
    planNarrative:
      'I\'ll update the visual theme by swapping the colour palette in the stylesheet and ' +
      'updating the page title to reflect the new look. ' +
      'Only two files change: the CSS file that owns all colours, and the HTML shell.',
    diffNarrative: (paths) =>
      `${paths.length} file(s) were updated: ${paths.join(', ')}. ` +
      'The CSS background colour changed from deep navy (#0f172a) to deep purple (#1a0f2e), ' +
      'and the accent colour switched from sky blue (#38bdf8) to pink (#f472b6). ' +
      'The page title in index.html now reads "Tiny Inbox · Fresh Theme".',
    files: [
      {
        path: 'web/styles.css',
        action: 'modify',
        description: 'Controls colors, fonts, and layout for the entire app.',
        purpose: 'Owns the entire look of the app: swap the color palette.',
        dependsOn: [],
      },
      {
        path: 'web/index.html',
        action: 'modify',
        description: 'The HTML page shell that wires the stylesheet and app script together.',
        purpose: 'Page shell: reflect the new theme in the document title.',
        dependsOn: ['web/styles.css'],
      },
    ],
    writes: (files) => ({
      'web/styles.css': edit(
        edit(files['web/styles.css'] ?? '', '--bg: #0f172a;', '--bg: #1a0f2e;'),
        '--accent: #38bdf8;',
        '--accent: #f472b6;',
      ),
      'web/index.html': edit(
        files['web/index.html'] ?? '',
        '<title>Tiny Inbox</title>',
        '<title>Tiny Inbox · Fresh Theme</title>',
      ),
    }),
  },
  {
    match: /(search|filter)/i,
    summary: 'Add a live search box to filter the task list.',
    planNarrative:
      'I\'ll add a live search box above the task list that filters tasks as you type. ' +
      'A new search.js module handles the filtering logic, ' +
      'and the HTML shell gets an <input> element wired to it.',
    diffNarrative: (paths) =>
      `${paths.length} file(s) changed: ${paths.join(', ')}. ` +
      'A new search.js module was created with a filterTasks() function that matches task titles case-insensitively. ' +
      'The HTML page now includes a search <input> element above the task list.',
    files: [
      {
        path: 'web/search.js',
        action: 'create',
        description: 'Filters the visible task list as the user types.',
        purpose: 'New module that filters tasks by their title.',
        dependsOn: [],
      },
      {
        path: 'web/index.html',
        action: 'modify',
        description: 'The HTML page shell that wires the stylesheet and app script together.',
        purpose: 'Page shell: add the search input element.',
        dependsOn: ['web/search.js'],
      },
    ],
    writes: (files) => ({
      'web/search.js':
        '// Filters a task list by a query string (case-insensitive).\nexport function filterTasks(tasks, query) {\n  const q = query.trim().toLowerCase();\n  if (!q) return tasks;\n  return tasks.filter((task) => task.title.toLowerCase().includes(q));\n}\n',
      'web/index.html': edit(
        files['web/index.html'] ?? '',
        '      <ul id="task-list"></ul>',
        '      <input id="search-input" placeholder="Search…" />\n      <ul id="task-list"></ul>',
      ),
    }),
  },
];

/**
 * Deterministic fallback adapter. It recognizes a few intents against the known sample
 * target and, for anything else, proposes a safe single-file annotation so the pipeline
 * still produces a real plan + diff on an arbitrary repo.
 */
export class MockAdapter implements AgentAdapter {
  readonly kind = 'mock' as const;

  async producePlan(request: string, index: RepoIndex): Promise<PlanResult> {
    const scenario = SCENARIOS.find((s) => s.match.test(request));
    const files = scenario
      ? scenario.files.filter((f) => index.filePaths.includes(f.path) || f.action === 'create')
      : this.genericPlan(request, index);

    const plan: ChangePlan = {
      id: newId('plan'),
      requestId: newId('req'),
      agent: 'mock',
      summary: scenario ? scenario.summary : `Apply the requested change: "${request}".`,
      files,
      createdAt: Date.now(),
    };

    const narrative = scenario
      ? scenario.planNarrative
      : `I'll apply the requested change ("${request}") to the most relevant file in the project. ` +
        `One file will be modified: ${files[0]?.path ?? 'none'}.`;

    return { plan, narrative };
  }

  async applyChange(plan: ChangePlan, currentFiles: FileMap): Promise<PlannedWrites> {
    const scenario = SCENARIOS.find((s) => s.summary === plan.summary);
    const writes = scenario ? scenario.writes(currentFiles) : this.genericWrites(plan, currentFiles);
    // Only emit entries for files the plan actually touches.
    const scoped: PlannedWrites = {};
    for (const file of plan.files) {
      if (file.path in writes) scoped[file.path] = writes[file.path];
    }
    return scoped;
  }

  async narrateDiff(files: FileDiff[]): Promise<string> {
    if (files.length === 0) {
      return 'No files were changed by this operation.';
    }
    const changedPaths = files.map((f) => f.path);
    // Try to match the scenario by checking if the changed paths overlap with scenario files.
    const scenario = SCENARIOS.find((s) =>
      s.files.some((sf) => changedPaths.includes(sf.path)),
    );
    if (scenario) {
      return scenario.diffNarrative(changedPaths);
    }
    // Generic fallback: describe each file's line counts.
    const lines = files.map((f) => `${f.path} (+${f.added} -${f.removed})`).join(', ');
    return `${files.length} file(s) were modified: ${lines}. The changes reflect the approved plan.`;
  }

  async chat(message: string, index: RepoIndex, _history: ConversationTurn[]): Promise<ChatReply> {
    const files = index.filePaths;
    const repoName = index.repoRoot.split(/[\\/]/).pop() ?? 'this project';
    // The orchestrator embeds the real contents of files the question names, like:
    //   --- src/store.js ---\n<content>
    // Detect mentions from the USER'S question only (the embedded paths would otherwise
    // pollute folder/file matching), but use the embedded contents to ground the answer.
    const question = message.split('\n\nHere are the relevant file contents')[0];
    const lower = question.toLowerCase();
    const contents = parseEmbeddedFiles(message);
    const mock = (text: string): ChatReply => ({ text, source: 'mock' });

    // 1) A top-level folder was mentioned (e.g. "what does web do") → describe its files.
    const topDirs = [...new Set(files.map((f) => f.split('/')[0]).filter((d) => d && !d.includes('.')))];
    const dir = topDirs.find((d) => d.length >= 3 && wordRe(d).test(lower));
    if (dir) {
      const inDir = files.filter((f) => f.startsWith(`${dir}/`));
      const lines = inDir.map((f) => {
        const role = roleFor(f);
        const hint = contents[f] ? summarize(contents[f]) : '';
        return `• ${f}${role ? ` — ${role}` : ''}${hint ? `. ${hint}` : ''}`;
      });
      return mock(`The \`${dir}/\` folder in ${repoName} holds ${inDir.length} file(s):\n${lines.join('\n')}`);
    }

    // 2) A specific file was named (by path, base name, or stem) → explain it.
    for (const f of files) {
      const base = (f.split('/').pop() ?? f).toLowerCase();
      const stem = base.replace(/\.[^.]+$/, '');
      const hit =
        lower.includes(f.toLowerCase()) ||
        (base.length >= 3 && lower.includes(base)) ||
        (stem.length >= 3 && wordRe(stem).test(lower));
      if (hit) {
        const role = roleFor(f);
        const hint = contents[f] ? summarize(contents[f]) : '';
        return mock(
          `\`${f}\`${role ? ` is the ${role}` : ''}${hint ? ` — ${hint}` : ''}. ` +
            `Open it in the left tree to read the whole file, or tell me what to change and I'll plan it before touching anything.`,
        );
      }
    }

    // 3) Project-structure questions.
    if (/(what files|which files|list files|project structure|show files|what is in|how many files|overview)/i.test(message)) {
      const listed = files.slice(0, 15).map((f) => `\`${f}\``).join(', ');
      const more = files.length > 15 ? ` … and ${files.length - 15} more` : '';
      return mock(
        `The project contains ${files.length} file(s): ${listed}${more}. ` +
          `Ask about any one by name (e.g. "what does the store do?") for a real explanation.`,
      );
    }

    // 4) Change intent not caught elsewhere.
    if (/\b(add|change|update|remove|fix|create|delete|refactor|rename|move|make|implement)\b/i.test(message)) {
      const target = files.find((p) => /\.(js|ts|jsx|tsx|css|html|py|md)$/.test(p)) ?? files[0];
      return mock(
        `This looks like a change request ("${message.trim()}"). ` +
          `The most likely starting point is \`${target ?? 'one of the project files'}\`. ` +
          `Send it and I'll produce a plan showing exactly which files are involved — you can lock any file before approving.`,
      );
    }

    // 5) Honest generic reply.
    return mock(
      `I can answer questions about ${repoName} (${files.length} files), explain what any file or folder does, ` +
        `or plan a change. Try: "what does the store do?", "what does web do?", or describe a change you want. ` +
        `(Note: this is the offline mock — live IBM Bob is not reachable right now.)`,
    );
  }

  private genericPlan(request: string, index: RepoIndex): PlannedFileChange[] {
    // Pick the most relevant source file — avoid README and config files for generic plans
    const target =
      index.filePaths.find((p) => /\.(js|ts|jsx|tsx|py)$/.test(p) && !/readme|config|env/i.test(p)) ??
      index.filePaths.find((p) => /\.(js|ts|jsx|tsx|css|html|py|md)$/.test(p)) ??
      index.filePaths[0];
    if (!target) return [];
    return [
      {
        path: target,
        action: 'modify',
        purpose: `Implement the requested change: "${request}".`,
        dependsOn: [],
      },
    ];
  }

  private genericWrites(plan: ChangePlan, currentFiles: FileMap): PlannedWrites {
    const writes: PlannedWrites = {};
    for (const file of plan.files) {
      const base = currentFiles[file.path] ?? '';
      if (file.action === 'modify') {
        // Add a meaningful TODO comment rather than an invisible marker
        const ext = file.path.split('.').pop() ?? '';
        const comment = ['js', 'ts', 'jsx', 'tsx', 'css'].includes(ext)
          ? `/* TODO: ${file.purpose} */`
          : `<!-- TODO: ${file.purpose} -->`;
        writes[file.path] = `${base}\n${comment}\n`;
      }
    }
    return writes;
  }
}

/** Escape a string for safe use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A whole-word matcher for a name like "web" or "store" against a lowercased message. */
function wordRe(name: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(name.toLowerCase())}([^a-z0-9]|$)`);
}

/**
 * Extract the file contents the orchestrator embedded into the question, in the form:
 *   --- src/store.js ---
 *   <file content…>
 * so a fallback answer can be grounded in real code instead of just a file name.
 */
function parseEmbeddedFiles(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^--- (.+?) ---\n([\s\S]*?)(?=\n--- .+? ---\n|$)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    out[m[1].trim()] = m[2];
  }
  return out;
}

/** A best-effort, human role for a file based on its path and extension. */
function roleFor(path: string): string | undefined {
  const p = path.toLowerCase();
  const name = (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '');
  if (p.endsWith('.css')) return 'stylesheet that controls colors, fonts, and layout';
  if (p.endsWith('.html')) return "HTML page that holds the app's markup";
  if (p.endsWith('.md')) return 'documentation file';
  if (name === 'readme') return 'the project overview doc';
  if (name.includes('store')) return 'in-memory data model — it holds state and exposes read/write methods';
  if (name.includes('server') || name.includes('api')) return 'HTTP server that exposes the routes/endpoints';
  if (name.includes('app') && p.startsWith('web')) return 'front-end logic that calls the API and renders the UI';
  if (name.includes('test') || name.includes('spec')) return 'an automated test';
  if (/\.(js|ts|jsx|tsx)$/.test(p)) return 'source file';
  return undefined;
}

/** One-sentence gist of a file: its leading comment, else its first meaningful line. */
function summarize(content: string): string {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const comment = lines.find((l) => /^(\/\/|\/\*|#|\*)/.test(l));
  const raw = comment ?? lines[0] ?? '';
  const clean = raw.replace(/^(\/\/|\/\*|\*\/?|#)\s*/, '').replace(/\*\/$/, '').replace(/[.。]+$/, '').trim();
  if (!clean) return '';
  return clean.length > 160 ? `${clean.slice(0, 160)}…` : clean;
}
