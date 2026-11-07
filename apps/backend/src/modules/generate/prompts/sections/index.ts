import { stepsSection } from './steps.js';
import { dbSection } from './db.js';
import { networkSection } from './network.js';
import { specSection } from './spec.js';
import { flowSection } from './flow.js';

/** Extra generator system-prompt sections, one file per owning phase (edit only your file). */
export const WIDGET_PROMPT_SECTIONS: string[] = [stepsSection, dbSection, networkSection, specSection, flowSection].filter(Boolean);
