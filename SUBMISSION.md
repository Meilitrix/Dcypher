# Decypher — Hackathon Submission Packet

IBM Bob 2.0 Hackathon - lablab.ai - closes **Sep 27, 2026, 11:00 AM ET**

Fill the bracketed placeholders, then copy the relevant sections into the lablab.ai
submission form. Screenshots go in `docs/screenshots/` and are shown in the README Showcase.

---

## Links (fill these in)

- **Repo (public):** https://github.com/Meilitrix/Dcypher
- **Live demo:** [your onrender URL]
- **Demo video (2-5 min):** [record a Loom/YouTube - usually REQUIRED by lablab]
- **Team / members:** [names + roles]

---

## Problem statement

AI coding agents (including IBM Bob 2.0) are powerful but **opaque and risky in a real
codebase**. Today a developer asks for a change and gets one of two bad outcomes: either
they trust the agent's edits blindly, or they manually read raw diffs and re-review
everything the model touched. There is no built-in way to:

- **see the plan before files change,**
- **stop the agent from touching files that must not change** (migrations, secrets,
  generated code, hot paths),
- **review exactly what changed and why in plain English, or roll back cleanly.**

For workflows like **code review, application maintenance, and release/deployment**, this
costs time (re-reviewing agent output), causes errors (unintended edits to critical
files), and creates rework (no safe revert). The blast radius of "just let the AI do it"
is unbounded.

## The solution - Decypher

Decypher is a **control and comprehension layer** that sits between the user's request and
the agent's edits. The agent still writes the code; Decypher wraps every change in a
guarded, reviewable lifecycle:

1. **Plan before change** - the agent proposes which files it will touch and why; nothing
   is written until the human approves.
2. **Protect what matters** - lock files with glob rules; if a plan violates a boundary the
   change is blocked and the agent must ask.
3. **Compare before / after** - both versions are snapshotted in git; the user sees real
   per-file diffs (or an interactive live view of the app before vs after) and can **Keep**
   or **Revert**.
4. **AI narration** - the agent explains each plan and each completed change in plain
   English, so review doesn't require parsing raw diffs.

The whole thing rests on one seam - an `AgentAdapter` interface - so the same UI runs
against **live IBM Bob 2.0** or a deterministic fallback, and the demo never breaks.

## How we used IBM Bob 2.0 (required criterion)

- **Bob as the agent inside the product:** Decypher's `BobAdapter` calls IBM Bob 2.0 to
  produce change plans, apply edits with real codebase context, and narrate diffs for the
  user. Bob is the intelligence the control layer governs.
- **Bob to build Decypher itself:** the orchestrator, adapters, snapshot/diff engine, and
  the React control UI were developed *with* IBM Bob 2.0 - codebase-aware chat and agentic
  edits across the full stack. Screenshots of those Bob sessions are in the Showcase
  (`01-bob-session.png`).
- **Leveraged Bob features:** codebase context / Agent-style change generation for planning
  and applying, and natural-language explanation for the narration step.

## Impact / why it's better

- **Cuts review time:** a plain-English "what will change / what changed" replaces manual
  diff reading for each agent change.
- **Prevents errors:** protected-file boundaries stop the agent from editing critical files
  - turning an unbounded blast radius into a gated one.
- **Eliminates rework fear:** git-backed before/after snapshots mean revert is one click.
- **Keeps the human in control:** the agent proposes, the developer approves - trust without
  blind faith.
- **Demonstrated on a real project:** the bundled `sample-target/` (a small "Tiny Inbox"
  app) shows a full plan, protect, apply, compare, revert cycle end to end.

## Tech stack

TypeScript monorepo - Vite + React 19 UI - Express orchestrator - simple-git snapshots -
zero-dep LCS diff engine - IBM Bob 2.0 via an OpenAI-compatible endpoint (with a
deterministic mock adapter for resilience). Single-origin build (the API server also serves
the UI) so it deploys as one container.

## What to submit - checklist

- [ ] **Public GitHub repo** (`Dcypher`) - README Showcase images committed and rendering.
- [ ] **Demo video** (2-5 min): open with the **real Bob session**, then walk one full
      Decypher cycle (plan, protect, apply, compare, revert) on `sample-target`.
- [ ] **Live URL** - the onrender link; hit it once to pre-warm before submitting.
- [ ] **Written submission** - paste Problem / Solution / How-we-used-Bob / Impact above.
- [ ] **Tech used** - tag **IBM Bob 2.0** prominently (it's the core requirement).
- [ ] **MIT-compliant / original** - confirm license; submissions must be MIT-compliant.
- [ ] **Post-hackathon feedback form** - complete after the event (2nd condition for the
      20 x $100 participation reward).

## Demo script (for the video)

1. (0:00) Hook - "AI agents edit real code with no guardrails." Show a scary raw diff.
2. (0:20) **Prove Bob** - 10-15s of the actual IBM Bob 2.0 session that built this.
3. (0:40) Open Decypher on `sample-target`; make a request - the **Plan** view appears,
   nothing written yet.
4. (1:20) Lock a file (`protect`), re-plan, show the **conflict** blocking apply.
5. (2:00) Approve, **apply**, **Compare** before/after diff + AI narration, then **live view**.
6. (2:40) **Revert** - back to original in one click.
7. (3:00) Close on impact: safer, faster, human-in-control AI-assisted maintenance.
