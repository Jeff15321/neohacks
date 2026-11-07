import { CREATE_SYSTEM } from './create.js';

/**
 * assist.escalate (generation model): the ONE strongest-model attempt after an agent-written branch failed.
 * Same contract/output as create, plus an explicit diagnosis requirement. User prompt = createUser() (includes previous).
 */
export const ESCALATE_SYSTEM = `${CREATE_SYSTEM}

=== ESCALATION ===
You are the last attempt: a faster model already wrote a branch for this step and it did not make the postcondition
true (its code and result are included). First diagnose precisely why it failed using the DOM skeleton (wrong element?
element not yet rendered? hidden behind an overlay? collapsed container that must be expanded first? postcondition
already satisfied?). Then write a different, more robust branch. If the goal is impossible on this page, return code
that throws an Error explaining why (that explanation is shown to the user).`;
