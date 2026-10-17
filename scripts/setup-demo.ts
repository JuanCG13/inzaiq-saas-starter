import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import nextEnv from '@next/env';
const {loadEnvConfig}=nextEnv;
import {templateConfig} from '../src/template.config';
if(process.env.NODE_ENV==='production')throw new Error('Demo setup is development-only');
const file='.env.local';
if(existsSync(file) && !/^DEMO_MODE=true$/m.test(readFileSync(file,'utf8')))throw new Error('Existing non-demo .env.local found. Preserve it; use a separate checkout for demo.');
const port=templateConfig.kind==='pos'?3001:3000;
if(!existsSync(file))writeFileSync(file,[`DATABASE_PROVIDER=sqlite`,`DATABASE_URL=file:./demo.db`,`APP_URL=http://localhost:${port}`,`BETTER_AUTH_URL=http://localhost:${port}`,`BETTER_AUTH_SECRET=${randomBytes(32).toString('base64url')}`,`STORE_TENANT_ID=demo-store`,`DEMO_MODE=true`,`OTEL_SERVICE_NAME=agentic-${templateConfig.kind}`,''].join('\n'),{mode:0o600});
loadEnvConfig(process.cwd());
if(!['sqlite'].includes(process.env.DATABASE_PROVIDER??'')||process.env.DATABASE_URL!=='file:./demo.db')throw new Error('Demo only seeds the isolated local demo.db');
const {getDatabase,migrateDatabase}=await import('../src/db');
const {getAuth}=await import('../src/lib/auth');
const {getMigrations}=await import('better-auth/db/migration');
const {seedDemo}=await import('../src/db/seed');
const db=getDatabase();
try {await migrateDatabase(db);await(await getMigrations(getAuth().options)).runMigrations();await seedDemo(db,{userId:'demo-owner',tenantId:'demo-store',role:'owner'},templateConfig.kind);console.info(`Local demo ready. Run npm run dev -- --port ${port}. MCP still requires a real OAuth login/consent.`);}finally{await db.destroy();}
