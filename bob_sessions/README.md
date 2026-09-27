# IBM Bob 2.0 — Session Evidence

Decypher was **designed and built with IBM Bob 2.0** across a series of IDE sessions.
This folder is the exported proof of that work: each screenshot is a real Bob session
where Bob read the codebase, planned features, and wrote code.

Bob was used two ways:

1. **As the development teammate** — the sessions below. Bob analyzed the repo, produced
   implementation plans, and applied the actual code changes (types, adapters, the
   orchestrator, and the React UI).
2. **As the runtime agent** — Decypher's `BobAdapter` (`packages/agent/bob.ts`) calls
   IBM Bob's inference API to produce change plans and narrate diffs for the user. When
   Bob is unreachable, it falls back to a deterministic mock so the demo never breaks.

> **Security note:** no API keys or secrets appear in these exports. The `BOB_API_KEY`
> lives only in the local `.env` (git-ignored) and is never committed or shown.

---

## The build story, session by session

| # | Screenshot | What Bob did |
|---|---|---|
| 1 | [01 · Gap analysis & build order](01-gap-analysis-build-order.jpg) | Read the whole repo and produced a **recommended build order** — 5 feature gaps, each mapped to the exact files it touches. |
| 2 | [02 · Plan: chat thread + diff narration](02-plan-chat-thread-and-diff-narration.jpg) | Wrote the implementation plan for the two highest-impact features — `producePlan` returning a narrative, and a new `narrateDiff` method. |
| 3 | [03 · Data flow & scope](03-data-flow-and-scope.jpg) | Specified the data flow and explicitly scoped what would **not** change (no new API routes, mock stays deterministic). |
| 4 | [04 · Applying the code diff](04-applying-code-diff-types.jpg) | Edited `packages/core/types.ts` live — added `ChatMessageKind` / `ChatMessage` / `chatHistory` — with the diff awaiting approval. |
| 5 | [05 · Tasks complete, 12 files changed](05-tasks-complete-12-files.jpg) | Finished the feature: 15/15 steps, 12 files changed, README updated, smoke assertions added. |
| 6 | [06 · UI redesign — three columns](06-ui-redesign-three-column.jpg) | Re-architected the interface into an IDE-style **file tree / chat / context** grid and rewrote `App.tsx`. |
| 7 | [07 · UI redesign — complete](07-ui-redesign-complete.jpg) | Applied the layout CSS and rewrote labels into plain English ("What will change", "Lock files you don't want touched", "Compare versions"). |
| 8 | [08 · Chat routing + mock-fallback fix](08-chat-routing-and-mock-fix.jpg) | Added the chat Q&A path and diagnosed the root cause of the non-AI fallback behavior in the mock adapter. |
| 9 | [09 · Adapter config + repo import](09-adapter-config-and-repo-import.jpg) | Wired `readBobConfig` (env-driven Bob API), planned plan/diff cards, the file viewer, and repo import. |

---

## Why this matters for judging

The challenge asks for a solution that **actively uses IBM Bob 2.0**. These exports show
Bob doing real engineering work — codebase analysis, planning, multi-file edits, and
refactors — not just answering questions. Decypher is the control-and-comprehension layer
that wraps that same agent capability for an end user.
