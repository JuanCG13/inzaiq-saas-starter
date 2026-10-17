import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import nextEnv from '@next/env';
const {loadEnvConfig}=nextEnv;
import {templateConfig} from '../src/template.config';
import {validateCurrencySettings,validateI18nSettings} from '../src/i18n/config';
if(process.env.NODE_ENV==='production')throw new Error('Demo setup is development-only');
// Fail before touching the database when the installation's language or currency settings cannot work.
const {i18n}=templateConfig;
validateI18nSettings(i18n);validateCurrencySettings(templateConfig);
const file='.env.local';
if(existsSync(file) && !/^DEMO_MODE=true$/m.test(readFileSync(file,'utf8')))throw new Error('Existing non-demo .env.local found. Preserve it; use a separate checkout for demo.');
const port=templateConfig.kind==='pos'?3001:3000;
if(!existsSync(file))writeFileSync(file,[`DATABASE_PROVIDER=sqlite`,`DATABASE_URL=file:./demo.db`,`APP_URL=http://localhost:${port}`,`BETTER_AUTH_URL=http://localhost:${port}`,`BETTER_AUTH_SECRET=${randomBytes(32).toString('base64url')}`,`STORE_TENANT_ID=demo-store`,`DEMO_MODE=true`,`OTEL_SERVICE_NAME=agentic-${templateConfig.kind}`,''].join('\n'),{mode:0o600});
loadEnvConfig(process.cwd());
if(!['sqlite'].includes(process.env.DATABASE_PROVIDER??'')||process.env.DATABASE_URL!=='file:./demo.db')throw new Error('Demo only seeds the isolated local demo.db');
const {getDatabase,migrateDatabase}=await import('../src/db');
const {getAuth}=await import('../src/lib/auth');
const {getMigrations}=await import('better-auth/db/migration');
const {demoCatalog,seedDemo}=await import('../src/db/seed');
const db=getDatabase();
const demoActor={userId:'demo-owner',tenantId:'demo-store',role:'owner'} as const;
try {
  await migrateDatabase(db);await(await getMigrations(getAuth().options)).runMigrations();
  await seedDemo(db,demoActor,templateConfig.kind,templateConfig.currency);
  // Seeding is idempotent by SKU and never rewrites a product, so an older demo.db keeps its old names, language and currency.
  const expected=demoCatalog(templateConfig.kind,templateConfig.currency);
  const rows=await db.selectFrom('commerce_products').select(['sku','name','currency']).where('tenant_id','=',demoActor.tenantId).where('sku','in',expected.map(item=>item.sku)).execute();
  const stale=rows.filter(row=>expected.some(item=>item.sku===row.sku&&(item.name!==row.name||item.currency!==row.currency)));
  if(stale.length)console.warn(`demo.db already has ${stale.length} demo product(s) whose name or currency differ from the current demo catalog (${templateConfig.currency}). They were NOT changed or converted. Delete demo.db and rerun to reseed.`);
  console.info(`Local demo ready: ${templateConfig.currency} prices, languages ${i18n.locales.join(', ')} (default ${i18n.defaultLocale}). Run npm run dev -- --port ${port}. MCP still requires a real OAuth login/consent.`);
}finally{await db.destroy();}
