import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { toHtml } from './docview';

/** Поток разбора документа (DocView): главный процесс и интерфейс не ждут, даже если файл огромный. */
const { path, name } = workerData as { path: string; name: string };
let html: string | null;
try {
  html = toHtml(readFileSync(path), name);
} catch {
  html = null;
}
parentPort?.postMessage(html);
