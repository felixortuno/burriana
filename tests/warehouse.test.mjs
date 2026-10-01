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
console.log('OK: autor autenticado, cierre, ediciones inexistentes, calendario real y cuartos de palet.');
