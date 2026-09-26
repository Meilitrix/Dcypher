import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { DecypherOrchestrator } from '../server/orchestrator';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..', 'sample-target');
const WORK = join(here, '..', '.decypher-smoke');
const PREVIEW = join(here, '..', '.decypher-smoke-preview');

let passed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`  ok - ${msg}`);
}

async function main(): Promise<void> {
  const orch = new DecypherOrchestrator(WORK, PREVIEW, { before: 3001, after: 3002 });

  // --- Scenario 1: plan a due-date change, protect the render layer, replan, apply. ---
  console.log('\n[1] due-date change with protection + keep-and-replan');
  let s = orch.createSession(REPO, 'mock');
  s = await orch.plan(s.id, 'Add due dates to tasks');
  assert(s.plan && s.plan.files.length >= 2, 'plan produced multiple files');
  assert(s.stage === 'planned', 'no conflicts before protecting');

  s = orch.addProtection(s.id, 'web/app.js', 'render layer');
  assert(s.stage === 'blocked', 'locking web/app.js blocks the plan');
  assert(!!s.conflict && s.conflict.conflicts.length >= 1, 'conflict is reported');

  s = orch.resolve(s.id, 'keep-and-replan');
  assert(s.stage === 'planned', 'keep-and-replan clears the conflict');
  assert(!s.plan!.files.some((f) => f.path === 'web/app.js'), 'protected file dropped from plan');

  s = await orch.apply(s.id);
  assert(s.stage === 'applied', 'apply succeeds within boundaries');
  const changed = s.diff!.changedFiles.map((f) => f.path);
  assert(changed.includes('src/store.js'), 'store.js changed');
  assert(!changed.includes('web/app.js'), 'protected web/app.js was NOT changed');
  assert(changed.includes('src/util/dates.js'), 'new file src/util/dates.js created');

  const before = orch.fileContent(s.id, 'before', 'src/store.js');
  const after = orch.fileContent(s.id, 'after', 'src/store.js');
  assert(before !== after && after.includes('dueDate'), 'before/after contents differ as expected');

  s = orch.revert(s.id);
  assert(s.stage === 'planned' && !s.diff, 'revert drops the diff and returns to planned');

  // --- Scenario 2: protect the theme, then allow the change to prove the unblock path. ---
  console.log('\n[2] theme change with allow-and-unlock');
  let t = orch.createSession(REPO, 'mock');
  t = await orch.plan(t.id, 'Refresh the visual theme');
  t = orch.addProtection(t.id, 'web/styles.css', 'all styling');
  assert(t.stage === 'blocked', 'locking styles.css blocks the theme plan');
  t = orch.resolve(t.id, 'allow');
  assert(t.stage === 'planned', 'allow-and-unlock clears the conflict');
  t = await orch.apply(t.id);
  const themeChanged = t.diff!.changedFiles.map((f) => f.path);
  assert(themeChanged.includes('web/styles.css'), 'styles.css changed after allow');

  // --- Scenario 3: generic fallback plan on an unknown request. ---
  console.log('\n[3] generic fallback');
  let g = orch.createSession(REPO, 'mock');
  g = await orch.plan(g.id, 'make the app nicer somehow');
  assert(g.plan && g.plan.files.length >= 1, 'fallback still yields a plan');

  console.log(`\nAll ${passed} assertions passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
