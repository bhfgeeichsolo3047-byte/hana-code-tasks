import { pathToFileURL } from 'node:url';

const root = process.env.DSH_APP_ROOT || 'D:\\dsh\\DSH Desktop Beta\\resources\\app';
const base = `${root.replace(/[\\/]+$/, '')}/node_modules`;
const mapped = new Map([
  ['@deepseek-ai/schemastery', `${base}/@deepseek-ai/schemastery/lib/index.mjs`],
  ['@deepseek-ai/dsh-storage-domain', `${base}/@deepseek-ai/dsh-storage-domain/lib/index.js`],
  ['@deepseek-ai/dsh-web-fetch-http', `${base}/@deepseek-ai/dsh-web-fetch-http/lib/index.js`],
  ['zod', `${base}/zod/index.js`],
]);

export async function resolve(specifier, context, nextResolve) {
  const target = mapped.get(specifier);
  if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
