# content/overlay

Extension-owned in-page UI (vanilla TS + Shadow DOM, <10 KB CSS, no React):
REC pill (Phase B — `rec-pill.ts`, implemented), danger Allow/Block confirm (Phase C), suggestion card (Phase D), flow progress pill (Phase F).
Keep one file per surface (`rec-pill.ts`, `danger-confirm.ts`, `suggestion-card.ts`, `flow-pill.ts`) to avoid merge conflicts.
Host ids start with `wwa-` so the Step recorder and DOM skeletons ignore them.
