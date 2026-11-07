/// <reference lib="webworker" />
/** Service worker entry: wires modules to the bus. Nothing else. */
import { BROADCAST_TYPES } from '@app/contracts';
import { Bus } from './bus.js';
import { runtime, userScripts } from './platform/index.js';
import { registerSystem } from './modules/system/index.js';
import { registerWidgets } from './modules/widgets/index.js';
import { registerNet } from './modules/net/index.js';
import { registerObserve } from './modules/observe/index.js';
import { registerRecord } from './modules/record/index.js';
import { registerFlow } from './modules/flow/index.js';
import { registerJobs } from './modules/jobs/index.js';
import { registerData } from './modules/data/index.js';
import { registerAssist } from './modules/assist/index.js';

const bus = new Bus({ broadcast: runtime.broadcast });
(globalThis as { __wwaBus?: Bus }).__wwaBus = bus; // debugging from the SW console / tests

registerSystem(bus);
registerWidgets(bus);
registerNet(bus);
registerObserve(bus);
registerRecord(bus);
registerFlow(bus);
registerJobs(bus);
registerData(bus);
registerAssist(bus);

void userScripts.configureWorld();
runtime.onStartup(() => void userScripts.configureWorld());

runtime.onMessage((raw, sender, respond) => {
  const type = (raw as { type?: string } | null)?.type;
  if (type && BROADCAST_TYPES.has(type)) return; // our own broadcasts looping back
  void bus.dispatch(runtime.isExtensionPage(sender) ? 'panel' : 'content', raw, sender).then(respond);
  return true;
});
runtime.onUserScriptMessage((raw, sender, respond) => {
  void bus.dispatch('userScript', raw, sender).then(respond);
  return true;
});
