# Next-gen build progress
_Last updated: 2026-11-07 (start) by coordinator (local Devin CLI session)_

## Status board
| Phase | Status (not started / in progress / gate running / DONE / DONE-DEGRADED / blocked) | Branch/PR | Gate result | Updated |
|---|---|---|---|---|
| 0 Foundation | in progress | `nextgen` (coordinator, direct) | — | start |
| C Self-healing runtime | not started | — | — | — |
| B Steps + recording + Inspector | not started | — | — | — |
| A User data store | not started | — | — | — |
| E Network upgrades | not started | — | — | — |
| D Activity + suggestions + jobs | not started | — | — | — |
| F Cross-site flows | not started | — | — | — |

## Now working on
- coordinator: Phase 0 — baseline MVP test run + reading MVP reference code, next: contracts/core/widget-runtime packages

## Up next
- Phase 0: new layout (contracts, core, widget-runtime, bus, platform, module stubs, callModel + llm_calls, panel tab shell), port MVP behaviour, port E2E specs.
- Then C ∥ B ∥ A ∥ E as parallel subagents in separate git worktrees, each on its own backend port.
- Then D ∥ F once B (and C for F) gates pass.

## Phase reports
(none yet)

## Decisions (made without the human)
- start — `nextgen` branched from `feat/network-observation` (89963a5), not `mvp`; `mvp-final` tag placed on 89963a5 — `mvp` lacks the netprobe window.fetch fallback commit; human approved this before leaving — rejected: branching from `mvp` exactly as the doc says.
- start — Child "Devin sessions" are local Devin CLI subagents (max 4 parallel), each in its own `git worktree`; PRs opened via `gh` into `nextgen`, merged by the coordinator — the human runs Devin CLI locally.
- start — Phase 0 done by the coordinator directly (it touches every path, splitting it would only create merge conflicts).
- start — E2E backend port made configurable (`E2E_PORT`, default 8787) in Phase 0 so parallel worktrees don't collide on :8787.

## Stuck log
(none yet)

## Final summary
(Written at the end.)
