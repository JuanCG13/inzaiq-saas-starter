/** Local arithmetic guard only: no network, credentials, infrastructure or DB calls. */
import { readFileSync } from 'node:fs';

function scalar(document, name) {
  const matches = [...document.matchAll(new RegExp(`^\\s*${name}:\\s*([^#\\n]+)`, 'gm'))];
  if (matches.length !== 1) throw new Error(`Expected one ${name} in the reference manifest.`);
  return matches[0][1].trim().replace(/^['"]|['"]$/g, '');
}
function integer(value, name, min, max) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error(`${name} must be an integer.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${name} is outside its supported range.`);
  return result;
}
try {
  const hpa = readFileSync(new URL('./hpa.yaml', import.meta.url), 'utf8');
  const deployment = readFileSync(new URL('../kubernetes.yaml', import.meta.url), 'utf8');
  const maxReplicas = integer(scalar(hpa, 'maxReplicas'), 'maxReplicas', 1, 100000);
  const surgeSetting = scalar(deployment, 'maxSurge');
  const surgePods = surgeSetting.endsWith('%')
    ? Math.ceil(maxReplicas * integer(surgeSetting.slice(0, -1), 'maxSurge percent', 0, 1000) / 100)
    : integer(surgeSetting, 'maxSurge', 0, 100000);
  const poolPerProcess = integer(process.env.PG_POOL_MAX ?? '5', 'PG_POOL_MAX', 1, 100);
  const drainingPods = integer(process.env.DRAINING_POD_RESERVE ?? '2', 'DRAINING_POD_RESERVE', 0, 100000);
  const otherConnections = integer(process.env.OTHER_CONNECTION_RESERVE ?? '5', 'OTHER_CONNECTION_RESERVE', 0, 1000000);
  const availableConnections = integer(process.env.DB_APP_CONNECTION_BUDGET, 'DB_APP_CONNECTION_BUDGET (required)', 1, 1000000);
  const requiredConnections = (maxReplicas + surgePods + drainingPods) * poolPerProcess + otherConnections;
  const fits = requiredConnections <= availableConnections;
  console.log(JSON.stringify({ fits, maxReplicas, surgePods, drainingPods, poolPerProcess, otherConnections, requiredConnections, availableConnections }, null, 2));
  if (!fits) {
    console.error('Incompatible budget: reduce HPA maxReplicas/pool size or obtain a validated larger database allocation. Do not remove operational reserves to hide a deficit.');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid capacity configuration.');
  process.exitCode = 1;
}
