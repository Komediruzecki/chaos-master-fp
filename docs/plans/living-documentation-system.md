# Living documentation system: brainstorm and minimal pilot

## The idea worth borrowing

Moxie Docs presents documentation as something that stays connected to the product rather than a static wiki that slowly drifts. We should borrow that operating principle, not its branding or implementation: code changes create a small, reviewable documentation obligation while agents receive the relevant context before they edit.

The first version should remain repository-native. Markdown stays reviewable in Git, local work remains possible, and no private code or prompts leave the machine.

## Brainstorm agenda (60 minutes)

| Time      | Question                                                           | Output                                           |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| 0–10 min  | Who uses internal docs, and which stale page has hurt us recently? | Three concrete failure stories and their cost    |
| 10–20 min | Which code areas and docs must evolve together?                    | Initial ownership/coherence map                  |
| 20–30 min | Where should agents read context and report drift?                 | Hook points: task start, post-edit, PR, merge    |
| 30–40 min | What can be deterministic, and what genuinely needs an LLM?        | Boundary between path checks and semantic review |
| 40–50 min | What evidence earns trust?                                         | Metrics and a false-positive budget              |
| 50–60 min | What is the smallest two-week pilot?                               | Owner, repositories, success criteria, rollback  |

Use a real change as the workshop exercise. Ask one person to find the relevant docs manually, one agent to use the generated context, and compare missed pages, time, and unnecessary edits.

## Minimal working example in this repository

The pilot has four pieces:

1. `docs/coherence-map.json` maps source paths to documents and review questions.
2. `pnpm docs:context` prints a compact briefing an agent can read before work.
3. `pnpm docs:check --base <git-ref>` reports mapped code changes that have no corresponding documentation change.
4. `pnpm docs:check --base <git-ref> --strict` returns a non-zero status for use as a local or CI quality gate.

Example agent loop:

```sh
pnpm docs:context
# Agent makes and tests its change.
pnpm docs:check --base origin/main
```

The check deliberately reports a review obligation, not proof that prose is wrong. A developer may update the mapped document or record in the PR why the implementation change does not affect it. This avoids noisy, low-quality automatic prose rewrites.

## Architecture beyond the pilot

```text
git diff / agent events
        │
        ▼
deterministic path mapper ──► relevant docs + review questions
        │
        ├──► PR check and human acknowledgement
        │
        └──► optional semantic reviewer (read-only)
                    │
                    ▼
             suggested patch with citations
```

Keep the deterministic mapper as the source of truth. An optional semantic reviewer can later compare changed symbols, tests, screenshots, and mapped pages, but it should suggest a patch rather than publish autonomously. Every generated claim should cite a source file, symbol, test, or decision record.

## Improvement ladder

### Phase 1 — establish signal (now)

- Expand the map only when a real drift incident occurs.
- Add ownership and criticality after teams agree on responsibility.
- Run the check in report-only mode for two weeks.
- Measure affected areas, acknowledged warnings, doc changes, and false positives.

### Phase 2 — integrate the workflow

- Add the report to pull requests and keep one updated bot comment per PR.
- Let agents request context for only the paths in their task, reducing prompt size.
- Store explicit “reviewed, no change needed” reasons as PR evidence.
- Fail CI only for high-criticality areas after the false-positive rate is acceptable.

### Phase 3 — semantic assistance

- Index headings and code symbols rather than arbitrary text chunks.
- Ask a read-only model to identify contradictions and missing behavior, with file-and-line citations.
- Generate a proposed Markdown patch and targeted reviewer list.
- Redact secrets, isolate repositories by tenant, and log which sources informed each suggestion.

### Phase 4 — a Moxie-like internal product

- Provide a dashboard for freshness, ownership, open review obligations, and agent runs.
- Add connectors for GitHub, issue tracking, runbooks, and architecture decisions.
- Track lineage from claim → source → commit → reviewer approval.
- Use feedback to rank suggestions; do not optimize for number of generated pages.

## Success measures and guardrails

Prefer outcome metrics: median time to find authoritative guidance, escaped stale-doc incidents, warning precision, review time, and percentage of critical areas with an owner. Page count and words generated are anti-metrics.

The system must not send proprietary code to an external model by default, merge generated text without review, treat a changed timestamp as freshness, or block an emergency fix merely because prose did not change. The long-term advantage is trustworthy provenance and workflow fit—not maximum automation.
