import type { ChangePlan, PlannedFileChange, RepoIndex } from '@decypher/core';
import { newId } from '@decypher/core';
import type { FileMap } from '@decypher/diff';
import type { AgentAdapter, PlannedWrites } from './adapter';

/** A canned scenario: how to describe the plan + how to transform the current files. */
interface Scenario {
  match: RegExp;
  summary: string;
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

  async producePlan(request: string, index: RepoIndex): Promise<ChangePlan> {
    const scenario = SCENARIOS.find((s) => s.match.test(request));
    const files = scenario
      ? scenario.files.filter((f) => index.filePaths.includes(f.path) || f.action === 'create')
      : this.genericPlan(request, index);

    return {
      id: newId('plan'),
      requestId: newId('req'),
      agent: 'mock',
      summary: scenario ? scenario.summary : `Apply the requested change: "${request}".`,
      files,
      createdAt: Date.now(),
    };
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

  private genericPlan(request: string, index: RepoIndex): PlannedFileChange[] {
    const target = index.filePaths.find((p) => /\.(js|ts|jsx|tsx|css|html|py|md)$/.test(p)) ?? index.filePaths[0];
    if (!target) return [];
    return [
      {
        path: target,
        action: 'modify',
        purpose: `Add a note reflecting the requested change: "${request}".`,
        dependsOn: [],
      },
    ];
  }

  private genericWrites(plan: ChangePlan, currentFiles: FileMap): PlannedWrites {
    const writes: PlannedWrites = {};
    for (const file of plan.files) {
      const base = currentFiles[file.path] ?? '';
      if (file.action === 'modify') {
        writes[file.path] = `${base}\n<!-- Decypher demo change: ${file.purpose} -->\n`;
      }
    }
    return writes;
  }
}
