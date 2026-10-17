import nextEnv from '@next/env';
const {loadEnvConfig}=nextEnv;
loadEnvConfig(process.cwd());
const {getDatabase,migrateDatabase}=await import('../src/db/index');
const db=getDatabase();
try {await migrateDatabase(db);console.info('Business migrations applied.');}finally{await db.destroy();}
