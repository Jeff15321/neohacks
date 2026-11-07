import { z } from 'zod';
import { msg, usMsg } from './_msg.js';

/** Owner: Phase F (extension modules/flow). Add this domain's messages here; messages/index.ts already spreads them. */
export const panel = [] as const;
export const page = [] as const;
export const toContent = [] as const;
export const userScript = [] as const;
export const broadcast = [] as const;

// keep imports referenced until the owner adds messages
void z; void msg; void usMsg;
