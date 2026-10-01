import { isWarehouseArea, type WarehouseArea } from './areas.ts';
import { applySettings } from './settings.ts';
import { applyOperationalAction, isOpenWorkOrder, isValidCalendarDate, normalizeOperationalState, parseProduction, resolveOperationActor, type OperationActor, type OperationalState, type WorkOrder } from './operations.ts';
export type { WorkOrder, WorkOrderKind, WorkOrderStatus, WorkOrderPriority, ShiftSettings, OperationActor, ProductionSpecification } from './operations.ts';
/** boxesPerPallet: cajas montadas que caben en un palet de esa referencia; varía con la plancha. */
export type Product={id:string;sku:string;name:string;family:string;minimum:number;boxesPerPallet?:number};
export type Location={id:string;code:string;zone:string;capacity:number;sku:string;qty:number;area?:WarehouseArea};
export type Movement={id:string;date:string;kind:'entrada'|'salida'|'traslado'|'consumo'|'produccion'|'ajuste';sku:string;qty:number;location:string;destination:string;operator:string;document:string;notes:string;stacked:boolean;workOrderId?:string;actorId?:string};
export type Task={id:string;title:string;zone:string;owner:string;due:string;done:boolean};
export type Closure={id:string;day:string;date:string;operator:string;checks:boolean[];notes:string;actorId?:string};
export type State={products:Product[];locations:Location[];movements:Movement[];tasks:Task[];closures:Closure[]}&OperationalState;
export type LegacyState=Omit<State,'workOrders'|'shift'|'settings'>&Partial<OperationalState>;
/** The server passes the signed-in user; tests and local scripts may pass none. */
export type Actor=OperationActor&{role?:string};
export function normalizeState(state:LegacyState):State{return {...state,...normalizeOperationalState(state)};}
export const checklist=[['Maquinaria estacionada','Las 2 carretillas y los 2 toritos están en su zona.'],['Baterías y carga revisadas','Máquinas eléctricas conectadas según sus instrucciones de carga.'],['Pasillos despejados y barridos','Sin plásticos, flejes, maderas ni palets en las zonas de tránsito.'],['Consumibles repuestos','Film, fleje y etiquetas preparados para las 07:00.'],['Residuos controlados','Contenedores revisados y vaciados si están llenos; entorno limpio.']];
export function initialState():State{return {products:[],locations:[],movements:[],closures:[],...normalizeOperationalState({}),tasks:[
{id:'5s-1',title:'Barrer las zonas de cartón y cajas',zone:'Cartón y cajas',owner:'Equipo',due:'',done:false},
{id:'5s-2',title:'Marcar calles y bloques de almacenaje',zone:'Zona de stock',owner:'Equipo',due:'',done:false},
{id:'5s-3',title:'Separar y ordenar las referencias',zone:'Zona de stock',owner:'Equipo',due:'',done:false},
{id:'5s-4',title:'Despejar el muelle y ordenar palets vacíos',zone:'Muelle y expediciones',owner:'Operario 1',due:'',done:false},
{id:'5s-5',title:'Revisar film, flejes y etiquetas',zone:'Producción y montaje',owner:'Operario 2',due:'',done:false},
{id:'5s-6',title:'Asignar contenedores y zona de maquinaria',zone:'Residuos y maquinaria',owner:'Operario 3',due:'',done:false},
{id:'5s-7',title:'Codificar y señalizar las ubicaciones',zone:'Zona de stock',owner:'Equipo',due:'',done:false},
{id:'5s-8',title:'Completar el catálogo de referencias con SKU',zone:'Oficina',owner:'Responsable',due:'',done:false},
{id:'5s-9',title:'Implantar el checklist diario de las 14:45',zone:'Cartón y cajas',owner:'Responsable',due:'',done:false}
]};}
export function madridDay(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function str(v:unknown,label:string,required=true,max=180){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new Error(`Revisa el campo «${label}».`);return v.trim();}
// Stock admits quarter pallets (half and partial pallets are counted by hand); quarters stay exact in floating point.
function pallets(v:unknown,label:string){if(typeof v!=='number'||!Number.isInteger(v*4)||v<0.25||v>1000000)throw new Error(`«${label}» debe ser un número de palets mayor que 0, en cuartos (p. ej. 2,5 o 6,75).`);return v;}
function num(v:unknown,label:string,min=0){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>1000000)throw new Error(`«${label}» debe ser un número entero entre ${min} y 1.000.000.`);return v;}
function completeProduction(state:State,order:WorkOrder,action:Record<string,unknown>,now:Date,actor?:OperationActor){
 if(!isOpenWorkOrder(order))throw new Error('Un trabajo cerrado no se puede reabrir. Crea uno nuevo.');
 const production=parseProduction(action.production??order.production);
 if(!state.products.some(product=>product.sku===production.inputSku)||!state.products.some(product=>product.sku===production.outputSku))throw new Error('Las referencias de planchas y cajas deben existir en el catálogo.');
 const source=state.locations.find(location=>location.code===production.inputLocation);
 const target=state.locations.find(location=>location.code===production.outputLocation);
 if(!source||!target)throw new Error('Selecciona ubicaciones existentes para las planchas y las cajas.');
 if(source.sku!==production.inputSku||source.qty<production.inputPallets)throw new Error('No hay suficientes palets de planchas en el origen.');
 if(!isWarehouseArea(target.area))throw new Error('Asigna primero la zona de la ubicación de cajas.');
 if(target.qty&&target.sku!==production.outputSku)throw new Error('La ubicación de cajas contiene otra referencia.');
 if(target.qty+production.outputPallets>target.capacity)throw new Error('Las cajas producidas superan la capacidad de destino.');
 if(action.labelled!==true)throw new Error('Confirma las etiquetas de las cajas visibles en dos caras.');
 if(action.stacked===true&&action.safe!==true)throw new Error('Confirma la revisión del palet inferior antes de apilar las cajas.');
 const responsible=resolveOperationActor(actor);
 source.qty-=production.inputPallets;if(!source.qty)source.sku='';
 target.qty+=production.outputPallets;target.sku=production.outputSku;
 const shared={date:now.toISOString(),destination:'',operator:responsible.name,...(actor?{actorId:responsible.id}:{}),document:order.reference||order.id,notes:`Viaje de producción: ${order.title}`,workOrderId:order.id};
 state.movements.unshift(
  {...shared,id:crypto.randomUUID(),kind:'consumo',sku:production.inputSku,qty:production.inputPallets,location:source.code,stacked:false},
  {...shared,id:crypto.randomUUID(),kind:'produccion',sku:production.outputSku,qty:production.outputPallets,location:target.code,stacked:action.stacked===true}
 );
}
function requireAdmin(actor?:Actor){if(actor&&actor.role!=='administrador')throw new Error('Solo el administrador puede cambiar los ajustes y corregir el inventario directamente.');}
/**
 * Administrator correction: sets what a block really holds. It is recorded as an
 * «ajuste» movement with the before and after, so the history still adds up.
 */
function adjustStock(s:State,action:Record<string,unknown>,now:Date,actor?:Actor){
 const location=s.locations.find(l=>l.code===action.location);if(!location)throw new Error('Selecciona una ubicación.');
 const qty=action.qty;if(typeof qty!=='number'||!Number.isInteger(qty*4)||qty<0||qty>1000000)throw new Error('Los palets deben ir en cuartos, de 0 en adelante.');
 const capacity=action.capacity===undefined?location.capacity:num(action.capacity,'Capacidad',1);
 if(qty>capacity)throw new Error('La cantidad supera la capacidad del bloque. Sube también la capacidad.');
 const sku=qty?str(action.sku,'Referencia').toUpperCase():'';if(qty&&!s.products.some(p=>p.sku===sku))throw new Error('Selecciona una referencia del catálogo.');
 const reason=str(action.reason??'','Motivo',false,500);
 const before={sku:location.sku,qty:location.qty};
 if(before.sku===sku&&before.qty===qty&&capacity===location.capacity)throw new Error('No hay cambios que guardar.');
 location.capacity=capacity;location.qty=qty;location.sku=sku;
 if(before.sku===sku&&before.qty===qty)return;
 const responsible=resolveOperationActor(actor);const name=(code:string)=>s.products.find(p=>p.sku===code)?.name??code;
 const detail=before.sku===sku||!before.qty?`De ${before.qty} a ${qty} palets.`:`Antes ${before.qty} palets de ${name(before.sku)}; ahora ${qty} de ${name(sku)}.`;
 s.movements.unshift({id:crypto.randomUUID(),date:now.toISOString(),kind:'ajuste',sku:sku||before.sku,qty:before.sku===sku?Math.abs(qty-before.qty):qty||before.qty,location:location.code,destination:'',operator:responsible.name,...(actor?{actorId:responsible.id}:{}),document:'AJUSTE',notes:`Ajuste directo. ${detail}${reason?` Motivo: ${reason}`:''}`,stacked:false});
}
export function applyAction(current:LegacyState,action:Record<string,unknown>,now=new Date(),actor?:Actor):State{
 const s=structuredClone(normalizeState(current));const id=()=>crypto.randomUUID();
 switch(action.type){
 case 'workOrder':case 'shift':{applyOperationalAction(s,action,now,actor);break;}
 case 'workOrderStatus':{const order=s.workOrders.find(item=>item.id===action.id);if(order?.kind==='viaje'&&action.status==='completada'&&order.status!=='completada')completeProduction(s,order,action,now,actor);applyOperationalAction(s,action,now,actor);break;}
 case 'product':{const sku=str(action.sku,'SKU').toUpperCase();const existing=s.products.find(p=>p.id===action.id);if(action.id!==undefined&&!existing)throw new Error('Referencia no encontrada.');if(s.products.some(p=>p.sku===sku&&p.id!==existing?.id))throw new Error('Este SKU ya existe.');if(existing&&existing.sku!==sku)throw new Error('El SKU no se puede cambiar para conservar la trazabilidad.');const p:Product={id:existing?.id??id(),sku,name:str(action.name,'Nombre'),family:str(action.family??'Cantoneras','Familia'),minimum:num(action.minimum,'Stock mínimo')};
  // Absent keeps the stored value; empty or 0 clears it.
  const boxes=action.boxesPerPallet===undefined?existing?.boxesPerPallet:action.boxesPerPallet===null||action.boxesPerPallet===''||action.boxesPerPallet===0?undefined:num(action.boxesPerPallet,'Cajas por palet',1);if(boxes!==undefined)p.boxesPerPallet=boxes;
  if(existing){Object.assign(existing,p);if(boxes===undefined)delete existing.boxesPerPallet}else s.products.push(p);break;}
 case 'location':{const existing=s.locations.find(l=>l.id===action.id);if(action.id!==undefined&&!existing)throw new Error('Ubicación no encontrada.');const code=str(action.code,'Código').toUpperCase();if(s.locations.some(l=>l.code===code&&l.id!==existing?.id))throw new Error('Este código de ubicación ya existe.');if(existing&&existing.code!==code)throw new Error('El código no se puede cambiar para conservar el historial.');if(!isWarehouseArea(action.area))throw new Error('Asigna la ubicación al almacén de cartón o a montaje y almacenaje de cajas.');const capacity=num(action.capacity,'Capacidad',1);if(existing&&capacity<existing.qty)throw new Error('La capacidad no puede ser inferior a la ocupación actual.');const l={id:existing?.id??id(),code,zone:str(action.zone,'Zona o pasillo'),area:action.area,capacity,sku:existing?.sku??'',qty:existing?.qty??0};if(existing)Object.assign(existing,l);else s.locations.push(l);break;}
 case 'movement':{
 const kind=str(action.kind,'Tipo') as Movement['kind'];if(!['entrada','salida','traslado'].includes(kind))throw new Error('Tipo de movimiento no válido.');const sku=str(action.sku,'Referencia');if(!s.products.some(p=>p.sku===sku))throw new Error('Selecciona una referencia del catálogo.');const qty=pallets(action.qty,'Palets');const location=s.locations.find(l=>l.code===action.location);if(!location)throw new Error('Selecciona una ubicación.');const destination=kind==='traslado'?s.locations.find(l=>l.code===action.destination):null;
 if(kind==='traslado'&&(!destination||destination.code===location.code))throw new Error('Elige un destino diferente del origen.');const operator=actor?resolveOperationActor(actor).name:str(action.operator,'Responsable');const document=str(action.document??'','Albarán',kind==='salida');const notes=str(action.notes??'','Notas',false,1000);
 if(kind==='salida'&&action.verified!==true)throw new Error('Confirma la doble revisión de referencia y cantidad.');if(kind!=='salida'&&action.labelled!==true)throw new Error('Confirma las etiquetas visibles en dos caras.');if(kind!=='salida'&&action.stacked===true&&action.safe!==true)throw new Error('Confirma la revisión del palet inferior antes de apilar.');
 if(kind!=='entrada'){if(location.sku!==sku||location.qty<qty)throw new Error('No hay suficientes palets de esta referencia en el origen.');location.qty-=qty;if(!location.qty)location.sku='';}
 const target=kind==='entrada'?location:destination;if(target){if(!isWarehouseArea(target.area))throw new Error('Asigna primero la zona de la ubicación de destino en Ubicaciones.');if(target.qty&&target.sku!==sku)throw new Error('Cada bloque debe contener una sola referencia.');if(target.qty+qty>target.capacity)throw new Error('La entrada supera la capacidad de la ubicación.');target.qty+=qty;target.sku=sku;}
 s.movements.unshift({id:id(),date:now.toISOString(),kind,sku,qty,location:location.code,destination:destination?.code??'',operator,...(actor?{actorId:resolveOperationActor(actor).id}:{}),document,notes,stacked:action.stacked===true&&kind!=='salida'});break;
 }
 case 'task':{const existing=s.tasks.find(t=>t.id===action.id);if(action.id&&!existing)throw new Error('Tarea no encontrada.');const due=str(action.due??'','Fecha',false);if(due&&!isValidCalendarDate(due))throw new Error('Fecha no válida.');const t={id:existing?.id??id(),title:str(action.title,'Tarea'),zone:str(action.zone,'Zona'),owner:str(action.owner,'Responsable'),due,done:action.done===true};if(existing)Object.assign(existing,t);else s.tasks.push(t);break;}
 case 'closure':{if(!Array.isArray(action.checks)||action.checks.length!==5||!action.checks.every(x=>x===true))throw new Error('Completa las cinco comprobaciones antes de firmar.');const day=madridDay(now);if(s.closures.some(c=>c.day===day))throw new Error('El cierre de hoy ya está firmado.');s.closures.unshift({id:id(),day,date:now.toISOString(),operator:actor?resolveOperationActor(actor).name:str(action.operator,'Responsable'),...(actor?{actorId:resolveOperationActor(actor).id}:{}),checks:[true,true,true,true,true],notes:str(action.notes??'','Observaciones',false,1000)});break;}
 case 'settings':{requireAdmin(actor);s.settings=applySettings(s.settings,action,id);break;}
 case 'adjust':{requireAdmin(actor);adjustStock(s,action,now,actor);break;}
 default:throw new Error('Operación no válida.');
 }
 return s;
}
