export type Product={id:string;sku:string;name:string;family:string;minimum:number};
export type Location={id:string;code:string;zone:string;capacity:number;sku:string;qty:number};
export type Movement={id:string;date:string;kind:'entrada'|'salida'|'traslado';sku:string;qty:number;location:string;destination:string;operator:string;document:string;notes:string;stacked:boolean};
export type Task={id:string;title:string;zone:string;owner:string;due:string;done:boolean};
export type Closure={id:string;day:string;date:string;operator:string;checks:boolean[];notes:string};
export type State={products:Product[];locations:Location[];movements:Movement[];tasks:Task[];closures:Closure[]};
export const checklist=[['Maquinaria estacionada','Las 2 carretillas y los 2 toritos están en su zona.'],['Baterías y carga revisadas','Máquinas eléctricas conectadas según sus instrucciones de carga.'],['Pasillos despejados y barridos','Sin plásticos, flejes, maderas ni palets en las zonas de tránsito.'],['Consumibles repuestos','Film, fleje y etiquetas preparados para las 07:00.'],['Residuos controlados','Contenedores revisados y vaciados si están llenos; entorno limpio.']];
export function initialState():State{return {products:[],locations:[],movements:[],closures:[],tasks:[
{id:'5s-1',title:'Barrer a fondo toda la nave',zone:'Toda la nave',owner:'Equipo',due:'',done:false},
{id:'5s-2',title:'Marcar calles y bloques de almacenaje',zone:'Zona de stock',owner:'Equipo',due:'',done:false},
{id:'5s-3',title:'Separar y ordenar las referencias',zone:'Zona de stock',owner:'Equipo',due:'',done:false},
{id:'5s-4',title:'Despejar el muelle y ordenar palets vacíos',zone:'Muelle y expediciones',owner:'Operario 1',due:'',done:false},
{id:'5s-5',title:'Revisar film, flejes y etiquetas',zone:'Producción y montaje',owner:'Operario 2',due:'',done:false},
{id:'5s-6',title:'Asignar contenedores y zona de maquinaria',zone:'Residuos y maquinaria',owner:'Operario 3',due:'',done:false},
{id:'5s-7',title:'Codificar y señalizar las ubicaciones',zone:'Zona de stock',owner:'Equipo',due:'',done:false},
{id:'5s-8',title:'Completar el catálogo de referencias con SKU',zone:'Oficina',owner:'Responsable',due:'',done:false},
{id:'5s-9',title:'Implantar el checklist diario de las 14:45',zone:'Toda la nave',owner:'Responsable',due:'',done:false}
]};}
export function madridDay(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function str(v:unknown,label:string,required=true,max=180){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new Error(`Revisa el campo «${label}».`);return v.trim();}
function num(v:unknown,label:string,min=0){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>1000000)throw new Error(`«${label}» debe ser un número entero entre ${min} y 1.000.000.`);return v;}
export function applyAction(current:State,action:Record<string,unknown>,now=new Date()):State{
 const s=structuredClone(current);const id=()=>crypto.randomUUID();
 switch(action.type){
 case 'product':{const sku=str(action.sku,'SKU').toUpperCase();const existing=s.products.find(p=>p.id===action.id);if(s.products.some(p=>p.sku===sku&&p.id!==existing?.id))throw new Error('Este SKU ya existe.');if(existing&&existing.sku!==sku)throw new Error('El SKU no se puede cambiar para conservar la trazabilidad.');const p={id:existing?.id??id(),sku,name:str(action.name,'Nombre'),family:str(action.family??'Cantoneras','Familia'),minimum:num(action.minimum,'Stock mínimo')};if(existing)Object.assign(existing,p);else s.products.push(p);break;}
 case 'location':{const existing=s.locations.find(l=>l.id===action.id);const code=str(action.code,'Código').toUpperCase();if(s.locations.some(l=>l.code===code&&l.id!==existing?.id))throw new Error('Este código de ubicación ya existe.');if(existing&&existing.code!==code)throw new Error('El código no se puede cambiar para conservar el historial.');const capacity=num(action.capacity,'Capacidad',1);if(existing&&capacity<existing.qty)throw new Error('La capacidad no puede ser inferior a la ocupación actual.');const l={id:existing?.id??id(),code,zone:str(action.zone,'Zona o pasillo'),capacity,sku:existing?.sku??'',qty:existing?.qty??0};if(existing)Object.assign(existing,l);else s.locations.push(l);break;}
 case 'movement':{
 const kind=str(action.kind,'Tipo') as Movement['kind'];if(!['entrada','salida','traslado'].includes(kind))throw new Error('Tipo de movimiento no válido.');const sku=str(action.sku,'Referencia');if(!s.products.some(p=>p.sku===sku))throw new Error('Selecciona una referencia del catálogo.');const qty=num(action.qty,'Palets',1);const location=s.locations.find(l=>l.code===action.location);if(!location)throw new Error('Selecciona una ubicación.');const destination=kind==='traslado'?s.locations.find(l=>l.code===action.destination):null;
 if(kind==='traslado'&&(!destination||destination.code===location.code))throw new Error('Elige un destino diferente del origen.');const operator=str(action.operator,'Responsable');const document=str(action.document??'','Albarán',kind==='salida');const notes=str(action.notes??'','Notas',false,1000);
 if(kind==='salida'&&action.verified!==true)throw new Error('Confirma la doble revisión de referencia y cantidad.');if(kind!=='salida'&&action.labelled!==true)throw new Error('Confirma las etiquetas visibles en dos caras.');if(kind!=='salida'&&action.stacked===true&&action.safe!==true)throw new Error('Confirma la revisión del palet inferior antes de apilar.');
 if(kind!=='entrada'){if(location.sku!==sku||location.qty<qty)throw new Error('No hay suficientes palets de esta referencia en el origen.');location.qty-=qty;if(!location.qty)location.sku='';}
 const target=kind==='entrada'?location:destination;if(target){if(target.qty&&target.sku!==sku)throw new Error('Cada bloque debe contener una sola referencia.');if(target.qty+qty>target.capacity)throw new Error('La entrada supera la capacidad de la ubicación.');target.qty+=qty;target.sku=sku;}
 s.movements.unshift({id:id(),date:now.toISOString(),kind,sku,qty,location:location.code,destination:destination?.code??'',operator,document,notes,stacked:action.stacked===true&&kind!=='salida'});break;
 }
 case 'task':{const existing=s.tasks.find(t=>t.id===action.id);if(action.id&&!existing)throw new Error('Tarea no encontrada.');const due=str(action.due??'','Fecha',false);if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))throw new Error('Fecha no válida.');const t={id:existing?.id??id(),title:str(action.title,'Tarea'),zone:str(action.zone,'Zona'),owner:str(action.owner,'Responsable'),due,done:action.done===true};if(existing)Object.assign(existing,t);else s.tasks.push(t);break;}
 case 'closure':{if(!Array.isArray(action.checks)||action.checks.length!==5||!action.checks.every(x=>x===true))throw new Error('Completa las cinco comprobaciones antes de firmar.');const day=madridDay(now);if(s.closures.some(c=>c.day===day))throw new Error('El cierre de hoy ya está firmado.');s.closures.unshift({id:id(),day,date:now.toISOString(),operator:str(action.operator,'Responsable'),checks:[true,true,true,true,true],notes:str(action.notes??'','Observaciones',false,1000)});break;}
 default:throw new Error('Operación no válida.');
 }
 return s;
}
