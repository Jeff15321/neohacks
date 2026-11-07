import type { FastifyInstance } from 'fastify';
import type { GenerateWidgetRequest, GenerateWidgetResponse, InterpretStepsRequest, InterpretStepsResponse } from '@app/contracts';
import type { Config } from '../config.js';
import type { Db } from '../store/db.js';
import type { CallModel } from '../llm/types.js';

/**
 * In-process service interfaces between backend modules (Rules §2: modules never import each other's internals).
 * A module `provide`s in its register function; consumers `use` lazily at call time (registration order free).
 * Add entries here when a phase needs one.
 */
export interface BackendServices {
  /** modules/generate: the full generate pipeline (LLM + validator + one retry). Used by modules/jobs (Phase D). */
  'generate.widget': (body: GenerateWidgetRequest, traceId: string) => Promise<GenerateWidgetResponse>;
  /** modules/recordings: Tier-1 Step Interpreter. Used by modules/observe (Phase D). */
  'steps.interpret': (req: InterpretStepsRequest, traceId: string) => Promise<InterpretStepsResponse>;
}

export class ServiceRegistry {
  private fns = new Map<string, (...a: any[]) => any>();
  provide<K extends keyof BackendServices>(name: K, fn: BackendServices[K]) { this.fns.set(name, fn); }
  use<K extends keyof BackendServices>(name: K): BackendServices[K] {
    const fn = this.fns.get(name);
    if (!fn) throw new Error(`backend service ${name} not provided`);
    return fn as BackendServices[K];
  }
}

/** Everything a backend module may use. Modules never import each other's internals (Rules §2). */
export interface ModuleDeps {
  cfg: Config;
  db: Db;
  callModel: CallModel;
  services: ServiceRegistry;
}

export type RegisterModule = (app: FastifyInstance, deps: ModuleDeps) => void | Promise<void>;
