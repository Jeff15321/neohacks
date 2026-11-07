import { z } from 'zod';
import { msg as m } from './_msg.js';
import { Job } from '../jobs.js';

/** Owner: Phase D (extension modules/jobs: JobClient — background generation long-poll). */
export const panel = [
  /** Jobs known to the SW (Inspector / Activity). */
  m('JOBS_LIST', {}),
  m('JOB_CANCEL', { jobId: z.string() }),
] as const;
export const page = [] as const;
export const toContent = [] as const;
export const userScript = [] as const;
export const broadcast = [
  m('JOB_UPDATED', { job: Job }),
] as const;
