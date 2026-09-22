import { warehouseDb } from '@/db/warehouse';
import { applyAction, initialState, type State } from '@/lib/warehouse';
export const dynamic='force-dynamic';
async function read(){const row=await warehouseDb().prepare('SELECT revision,data FROM warehouse WHERE id=1').first<{revision:number;data:string}>();return row?{revision:row.revision,state:JSON.parse(row.data) as State}:{revision:0,state:initialState()};}
export async function GET(){try{return Response.json(await read(),{headers:{'Cache-Control':'no-store'}});}catch(e){console.error('warehouse read',e);return Response.json({error:'No se pueden cargar los datos. Inténtalo de nuevo.'},{status:503});}}
export async function POST(req:Request){
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Solicitud no permitida.'},{status:403});
 let body;try{const raw=await req.text();if(raw.length>12000)throw new Error();body=JSON.parse(raw);if(!body||!Number.isInteger(body.revision)||!body.action||typeof body.action!=='object')throw new Error();}catch{return Response.json({error:'Solicitud no válida.'},{status:400});}
 try{const current=await read();if(body.revision!==current.revision)return Response.json({error:'Los datos han cambiado. Actualiza y vuelve a guardar.'},{status:409});let state;try{state=applyAction(current.state,body.action);}catch(e){return Response.json({error:e instanceof Error?e.message:'Revisa los datos.'},{status:400});}
 const result=await warehouseDb().prepare('INSERT INTO warehouse (id, revision, data) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, data=excluded.data WHERE warehouse.revision=? RETURNING revision').bind(current.revision+1,JSON.stringify(state),current.revision).first();if(!result)return Response.json({error:'Otro cambio se ha guardado antes. Actualiza y vuelve a intentarlo.'},{status:409});return Response.json({state,revision:current.revision+1},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('warehouse write',e);return Response.json({error:'No se ha podido guardar. Conserva los datos e inténtalo de nuevo.'},{status:503});}
}
