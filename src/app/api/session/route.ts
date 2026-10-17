import {sql} from 'kysely';
import {getDatabase} from '@/db';
import {getAuth} from '@/lib/auth';
import {route} from '@/lib/http';
import {requestActor,isLocalDemo} from '@/lib/request-actor';
import {templateConfig} from '@/template.config';
export const runtime='nodejs';
export function GET(request:Request){return route(request,'api.session.read','/api/session',async()=>{const actor=await requestActor(request);const demo=isLocalDemo(request);if(demo)return {user:{id:actor.userId,name:'Demo administrator'},tenant:{id:actor.tenantId,name:templateConfig.name},role:actor.role,demo};const session=await getAuth().api.getSession({headers:request.headers});const org=await sql<{name:string}>`select name from organization where id=${actor.tenantId}`.execute(getDatabase());return {user:{id:actor.userId,name:session?.user.name??'User'},tenant:{id:actor.tenantId,name:org.rows[0]?.name??'Organization'},role:actor.role,demo};});}
