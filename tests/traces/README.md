# tests/traces — recorded Step logs + hand labels (Phase B)

- `<name>.capture.json` — Step log exported from a fixture run (`tests/tools/trace-capture.mjs`, same payload as the
  Inspector **Export trace** button): `{kind:'wwa-trace', name, steps: Step[]}`. Typed values are redacted previews only.
- `<name>.labels.json` — hand labels:
  - `tier1`: `{ "<seq>": "<regex over 'verb object'>" }` — expected Tier-1 meaning per Step.
  - `navigationOnly`: seqs that must be labelled `isNavigationOnly`.
  - `spec`: Workflow Interpreter expectations — `goal` / `goalNot` (regex), `minSlots`, `slot` (regex over input name+source),
    `consequential` (regex), `mustCite` (seqs cited by some spec step), `noise` (seqs that must NOT be cited by an
    essential step), `maxQuestions`, optional `struck` / `instructions` passed to the interpreter.
- Replay + score offline: `cd tests/tools && E2E_PORT=<port> node trace-eval.mjs` (against a mock backend = smoke test of
  the harness; against `LLM_PROVIDER=anthropic` = the real eval; `OUT=...json` saves the report).
- Re-capture: `cd tests/tools && E2E_PORT=<port> PW_PROFILE=/tmp/cap npx tsx trace-capture.mjs` (then re-check seqs in labels).
