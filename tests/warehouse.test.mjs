import assert from 'node:assert/strict';
import { initialState, applyAction, madridDay } from '../lib/warehouse.ts';
let s=initialState();
const apply=a=>s=applyAction(s,a,new Date('2026-09-22T12:45:00Z'));
apply({type:'product',sku:'REF-A',name:'Cantonera A',family:'Cantoneras',minimum:2});
apply({type:'product',sku:'REF-B',name:'Cantonera B',family:'Cantoneras',minimum:0});
assert.throws(()=>apply({type:'product',sku:'ref-a',name:'Duplicado',family:'Cantoneras',minimum:0}),/ya existe/);
for(const code of ['A-01','A-02','A-03'])apply({type:'location',code,zone:'Pasillo A',area:code==='A-03'?'montaje':'carton',capacity:8});
const base={type:'movement',kind:'entrada',sku:'REF-A',qty:5,location:'A-01',operator:'Prueba',labelled:true};
apply(base);assert.equal(s.locations[0].qty,5);
const unchanged=JSON.stringify(s);
for(const [action,error] of [[{...base,qty:4},/capacidad/],[{...base,qty:-1},/cuartos/],[{...base,qty:0},/cuartos/],[{...base,qty:1.3},/cuartos/],[{...base,sku:'REF-B',qty:1},/una sola referencia/],[{...base,labelled:false},/etiquetas/],[{...base,qty:1,stacked:true,safe:false},/inferior/],[{...base,kind:'salida',qty:6,verified:true,document:'ALB-1'},/suficientes/],[{...base,kind:'salida',qty:1,verified:false,document:'ALB-1'},/doble revisión/],[{...base,kind:'salida',qty:1,verified:true,document:''},/Albarán/]]){assert.throws(()=>applyAction(s,action),error);assert.equal(JSON.stringify(s),unchanged)}
apply({...base,kind:'traslado',qty:3,destination:'A-02'});assert.equal(s.locations[0].qty,2);assert.equal(s.locations[1].qty,3);assert.equal(s.locations.reduce((n,l)=>n+l.qty,0),5);
apply({...base,kind:'entrada',sku:'REF-B',qty:1,location:'A-03'});
const pre=JSON.stringify(s);assert.throws(()=>applyAction(s,{...base,kind:'traslado',qty:2,destination:'A-03'}),/una sola referencia/);assert.equal(JSON.stringify(s),pre);
apply({...base,kind:'salida',qty:2,verified:true,document:'ALB-1'});assert.equal(s.locations[0].qty,0);assert.equal(s.locations[0].sku,'');assert.equal(s.movements[0].operator,'Prueba');
assert.throws(()=>apply({type:'closure',checks:[true,true,false,true,true],operator:'Prueba'}),/cinco/);
apply({type:'closure',checks:[true,true,true,true,true],operator:'Prueba',notes:'Cierre de prueba'});assert.equal(s.closures[0].day,'2026-09-22');assert.throws(()=>apply({type:'closure',checks:[true,true,true,true,true],operator:'Prueba'}),/ya está firmado/);
assert.equal(madridDay(new Date('2026-09-22T22:30:00Z')),'2026-09-23');
apply({...s.tasks[0],type:'task',owner:'Operario real',done:true});assert.equal(s.tasks[0].done,true);
console.log('OK: entradas, salidas, traslados, capacidad, SKU único, revisión, atomicidad, cierre y fecha Madrid.');

assert.throws(()=>applyAction(s,{type:'location',code:'CER-01',zone:'Cerámica',area:'ceramica',capacity:4}),/cartón/);
assert.throws(()=>applyAction(s,{type:'location',code:'NO-ZONA',zone:'Pasillo A',capacity:4}),/cartón/);
const legacy=structuredClone(s);delete legacy.locations[0].area;const legacyBefore=JSON.stringify(legacy);assert.throws(()=>applyAction(legacy,{...base,qty:1}),/Asigna primero/);assert.equal(JSON.stringify(legacy),legacyBefore);
const assigned=applyAction(legacy,{...legacy.locations[0],type:'location',area:'carton'});assert.equal(assigned.locations[0].area,'carton');assert.deepEqual(assigned.movements,legacy.movements);
console.log('OK: ámbito cartón/cajas y asignación de ubicaciones anteriores sin pérdida de datos.');

// Authenticated attribution cannot be forged through a movement/closure form.
const actor={id:'manager-1',name:'Encargado real'};
const trusted=applyAction(s,{...base,qty:1,operator:'Nombre falsificado'},new Date('2026-10-01T08:00:00Z'),actor);
assert.equal(trusted.movements[0].operator,actor.name);
assert.equal(trusted.movements[0].actorId,actor.id);
const signed=applyAction(trusted,{type:'closure',checks:[true,true,true,true,true],operator:'Nombre falsificado'},new Date('2026-10-01T08:00:00Z'),actor);
assert.equal(signed.closures[0].operator,actor.name);
assert.equal(signed.closures[0].actorId,actor.id);
assert.throws(()=>applyAction(s,{type:'product',id:'missing',sku:'NEW',name:'Unexpected',family:'Cartón',minimum:0}),/no encontrada/);
assert.throws(()=>applyAction(s,{type:'location',id:'missing',code:'NEW',zone:'A',area:'carton',capacity:8}),/no encontrada/);
assert.throws(()=>applyAction(s,{type:'task',title:'Fecha imposible',zone:'A',owner:'Equipo',due:'2026-02-30',done:false}),/Fecha/);
{let q=initialState();const at=new Date('2026-09-30T12:00:00Z');q=applyAction(q,{type:'product',sku:'Q',name:'Fracción',family:'Planchas',minimum:0},at);q=applyAction(q,{type:'location',code:'Q-01',zone:'A',area:'carton',capacity:8},at);
q=applyAction(q,{type:'movement',kind:'entrada',sku:'Q',qty:6.75,location:'Q-01',operator:'Prueba',labelled:true},at);q=applyAction(q,{type:'movement',kind:'salida',sku:'Q',qty:0.25,location:'Q-01',operator:'Prueba',verified:true,document:'ALB-Q'},at);assert.equal(q.locations[0].qty,6.5);
q=applyAction(q,{type:'movement',kind:'salida',sku:'Q',qty:6.5,location:'Q-01',operator:'Prueba',verified:true,document:'ALB-Q'},at);assert.equal(q.locations[0].qty,0);assert.equal(q.locations[0].sku,'');}
{
 // Administrator-only: settings and direct stock corrections. Both are refused for an encargado.
 const admin={id:'adm',name:'Admin',role:'administrador'},boss={id:'enc',name:'Encargado',role:'encargado'},at=new Date('2026-10-01T09:00:00Z');
 let q=initialState();
 q=applyAction(q,{type:'product',sku:'BIE-PL',name:'Biedronka (plancha)',family:'Planchas',minimum:26},at,admin);
 q=applyAction(q,{type:'product',sku:'BIE-CJ',name:'Biedronka (caja)',family:'Cajas',minimum:0,boxesPerPallet:40},at,admin);
 q=applyAction(q,{type:'location',code:'CAJ-01',zone:'A',area:'montaje',capacity:10},at,admin);
 const rule={title:'Mantenimiento y limpieza',kind:'mantenimiento',weekday:5,everyWeeks:2,startDate:'2026-10-02',timing:{mode:'final',hours:2},notes:'',active:true};
 assert.throws(()=>applyAction(q,{type:'settings',section:'rule',value:rule},at,boss),/Solo el administrador/);
 assert.throws(()=>applyAction(q,{type:'adjust',location:'CAJ-01',sku:'BIE-CJ',qty:4},at,boss),/Solo el administrador/);
 q=applyAction(q,{type:'settings',section:'rule',value:rule},at,admin);assert.equal(q.settings.rules[0].title,'Mantenimiento y limpieza');
 // Editing the name without the field keeps the boxes per pallet; 0 clears it.
 const caja=q.products.find(p=>p.sku==='BIE-CJ');
 q=applyAction(q,{type:'product',id:caja.id,sku:'BIE-CJ',name:'Biedronka 40x30x23 (caja)',family:'Cajas',minimum:0},at,admin);assert.equal(q.products[1].boxesPerPallet,40);
 assert.throws(()=>applyAction(q,{type:'product',id:caja.id,sku:'BIE-CJ',name:'x',family:'Cajas',minimum:0,boxesPerPallet:2.5},at,admin),/entero/);
 // A correction records before and after as an «ajuste» movement.
 q=applyAction(q,{type:'adjust',location:'CAJ-01',sku:'BIE-CJ',qty:6.5,reason:'Recuento'},at,admin);
 assert.equal(q.locations[0].qty,6.5);assert.equal(q.movements[0].kind,'ajuste');assert.equal(q.movements[0].qty,6.5);assert.match(q.movements[0].notes,/De 0 a 6.5 palets. Motivo: Recuento/);
 q=applyAction(q,{type:'adjust',location:'CAJ-01',sku:'BIE-CJ',qty:4},at,admin);assert.equal(q.movements[0].qty,2.5);assert.equal(q.movements[0].operator,'Admin');
 assert.throws(()=>applyAction(q,{type:'adjust',location:'CAJ-01',sku:'BIE-CJ',qty:12},at,admin),/capacidad/);
 q=applyAction(q,{type:'adjust',location:'CAJ-01',sku:'BIE-CJ',qty:12,capacity:12},at,admin);assert.equal(q.locations[0].capacity,12);
 q=applyAction(q,{type:'adjust',location:'CAJ-01',qty:0},at,admin);assert.equal(q.locations[0].sku,'');assert.equal(q.movements[0].qty,12);
 assert.throws(()=>applyAction(q,{type:'adjust',location:'CAJ-01',qty:0},at,admin),/No hay cambios/);
 q=applyAction(q,{type:'product',id:caja.id,sku:'BIE-CJ',name:'x',family:'Cajas',minimum:0,boxesPerPallet:0},at,admin);assert.equal(q.products[1].boxesPerPallet,undefined);
}
console.log('OK: autor autenticado, cierre, ediciones inexistentes, calendario real, cuartos de palet, ajustes de administrador y cajas por palet.');
