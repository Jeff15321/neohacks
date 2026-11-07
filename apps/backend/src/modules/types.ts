import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../store/db.js';
import type { CallModel } from '../llm/types.js';

/** Everything a backend module may use. Modules never import each other's internals (Rules §2). */
export interface ModuleDeps {
  cfg: Config;
  db: Db;
  callModel: CallModel;
}

export type RegisterModule = (app: FastifyInstance, deps: ModuleDeps) => void | Promise<void>;
