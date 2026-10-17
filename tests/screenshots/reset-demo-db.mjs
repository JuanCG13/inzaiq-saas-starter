// Starts the screenshot tour from an empty local demo database, so the seed applies again and the
// orders table holds exactly the orders the tour places. Refuses to touch anything but the local demo.
import { existsSync, readFileSync, rmSync } from 'node:fs';

const envFile = '.env.local';
if (existsSync(envFile)) {
  const text = readFileSync(envFile, 'utf8');
  if (!/^DEMO_MODE=true$/m.test(text) || !/^DATABASE_URL=file:\.\/demo\.db$/m.test(text)) {
    throw new Error('Refusing to delete demo.db: .env.local is not the local demo configuration created by npm run demo:setup.');
  }
}
for (const file of ['demo.db', 'demo.db-wal', 'demo.db-shm', 'demo.db-journal']) rmSync(file, { force: true });
console.info('Local demo database reset for the screenshot tour.');
