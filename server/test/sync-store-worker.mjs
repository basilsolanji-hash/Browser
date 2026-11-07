import { parentPort, workerData } from 'node:worker_threads';
import { SyncStore } from '../src/sync-store.mjs';
const store = new SyncStore(workerData.path, { authorize: () => true });
try {
  const gate = new Int32Array(workerData.gate);
  Atomics.add(gate, 0, 1); Atomics.notify(gate, 0);
  if (Atomics.load(gate, 1) === 0) Atomics.wait(gate, 1, 0, 5000);
  parentPort.postMessage(store.apply(workerData.scope, workerData.request));
} catch (error) { parentPort.postMessage({ error: error.code ?? 'storage_failure' }); }
finally { store.close(); }
