# Decypher

A control and comprehension layer that sits between a user's request and an AI coding
agent's code changes. The agent (IBM Bob 2.0, or a deterministic mock) still reads the
repo and writes the code — Decypher adds a workflow that keeps the user in control and
informed at every step:

1. **Plan before change** — see which files will be touched and why, before anything is written.
2. **Protect what matters** — lock files as hard boundaries; the agent must stop and ask.
3. **Compare before and after** — both versions are preserved, with per-file diffs and reasons.
4. **AI narration** — the agent explains every step in plain English: what the plan will do,
   and what concretely changed after apply. No reading raw diffs required.

Built for the IBM Bob 2.0 hackathon.

## Run it

```bash
npm install
npm run dev:server   # orchestrator API on http://localhost:8787
npm run dev:web      # control UI on http://localhost:5173
```

Open http://localhost:5173. By default Decypher operates on the bundled `sample-target/`
(a small "Tiny Inbox" app). Switch the agent to `bob` in the header once `BOB_API_BASE`
and `BOB_API_KEY` are set (see `.env.example`); if Bob is unreachable it falls back to the
mock automatically, so the demo never breaks.

Scripts: `npm run smoke` (backend pipeline test), `npm run typecheck`, `npm run build`.

## Architecture

```
packages/
  core/      Shared contracts: ChangePlan, ProtectedRule, PlanConflict, DiffReport, ChatMessage, Session
  agent/     AgentAdapter interface + MockAdapter + BobAdapter (live, with mock fallback)
  protect/   Zero-dep glob matcher + ProtectionManager (boundary evaluation)
  snapshot/  Git-backed SnapshotManager (copy repo -> original commit -> modified commit -> revert)
  diff/      Zero-dep line diff (LCS) + DiffEngine (before/after report)
server/      DecypherOrchestrator — sequences index -> plan -> protect -> apply -> compare -> narrate
server.ts    Express API (CORS, REST endpoints, error mapping)
src/         React control UI (StageRail, PlanView, ProtectionPanel, ConflictPanel, CompareView, ChatThread)
sample-target/  Tiny standalone app used as the demo repo
```

The whole design rests on one seam: `AgentAdapter`. Decypher never assumes how the agent
thinks — it only requires a JSON `ChangePlan` in stage 1 and a set of file writes in
stage 3. That is what lets the same UI run against a live model or a scripted mock.

## How the four pillars are enforced

- **Plan** — `adapter.producePlan()` returns a `PlanResult`: the structured `ChangePlan` plus a
  plain-English `narrative` the user reads in the chat thread. Nothing is written until the
  user approves. Planned files are highlighted in both the plan view and the sidebar file tree.
- **Protect** — `ProtectionManager.evaluate(plan)` compares the plan against locked globs.
  Any hit produces a `PlanConflict` and blocks apply. On apply, protected files are dropped
  from the plan, so the agent literally cannot write them.
- **Compare** — `SnapshotManager` copies the target into an isolated workspace and commits
  the original; after the agent's writes are applied it commits the modified state. The
  before and after are read from commits (EOL-normalized) so diffs are real, never phantom.
  The user can Keep, Revert, or lock more files based on what they learn.
- **Narrate** — after apply, `adapter.narrateDiff()` receives the actual `FileDiff[]` and
  returns a plain-English paragraph describing what concretely changed — colours, labels,
  new fields, behaviours — so the user doesn't have to read raw `+/-` lines. The narrative
  is appended to the chat thread and stored on `DecypherSession.chatHistory`.

## Live before/after preview

After a change is applied, the Compare stage offers a **Source diff / Live preview**
toggle. **Live preview** spins up two throwaway static servers and shows the original
("Before") and modified ("After") apps side by side in interactive iframes, so you can
click buttons and type into inputs in both versions at once.

It is enabled automatically — no extra command. The two servers bind to fixed ports:

- **Before (original):** http://localhost:3001
- **After (modified):** http://localhost:3002

Override them with `PREVIEW_PORT_BEFORE` / `PREVIEW_PORT_AFTER` if the ports are taken.
Each snapshot's files are written into their own temp directory under
`.decypher-preview/` (equivalent to checking out that version) and served from there.

Live preview only works for an app that ships a self-contained runnable server (the
bundled `sample-target/` exposes `src/server.js`). For any repo it can't serve, or if a
preview server fails to boot, the UI shows
**"Live preview unavailable. Showing source diff instead."** and never crashes the flow.
Preview servers are stopped when you leave the Compare view, revert, or shut the
orchestrator down.

## Scope and honesty

Solid and demo-ready: the mock pipeline, protection blocking with the 3-way resolution,
git snapshots + revert, per-file diffs with explanations, the full control UI, and the
interactive live preview for the reference app.

Approximated by design: the dependency `dependsOn` graph (heuristic / agent-stated, not a
static analyzer). The UI always compares before/after at the source level for any repo;
live preview is best-effort and falls back to the source diff for apps it can't run.

Deliberately out of scope (future work): automatic behavioral diagnosis, long version
history, runtime tracing, and guaranteed dual-runtime execution of arbitrary repos.
