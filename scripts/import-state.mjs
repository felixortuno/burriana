// Imports a warehouse backup into Supabase, replacing whatever is stored.
//
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/import-state.mjs copia.json [--force]
//
// The file is the app's own "Descargar copia de datos" export: an object with
// products, locations, movements, tasks and closures (extra keys such as
// exportedAt or revision are ignored). Without --force the import refuses to
// overwrite a database that already holds data.

import { readFile } from 'node:fs/promises';
import { getPostgresWarehouseStore } from '../db/supabase-warehouse.ts';

const COLLECTIONS = ['products', 'locations', 'movements', 'tasks', 'closures'];

const args = process.argv.slice(2);
const force = args.includes('--force');
const [path] = args.filter((arg) => arg !== '--force');
if (!path) {
  console.error('Indica el archivo JSON a importar.');
  process.exit(1);
}

const file = JSON.parse(await readFile(path, 'utf8'));
// "Descargar copia de datos" writes the collections at the top level; a response
// saved straight from /api/warehouse nests them under "state".
const backup = file?.state && typeof file.state === 'object' ? file.state : file;
const state = {};
for (const key of COLLECTIONS) {
  if (!Array.isArray(backup?.[key])) {
    console.error(`El archivo no tiene un array «${key}»; no parece una copia del almacén.`);
    process.exit(1);
  }
  state[key] = backup[key];
}

// The app rejects duplicate SKUs and location codes, so a backup carrying them
// would load into a state the interface itself could never have produced.
for (const [key, field] of [['products', 'sku'], ['locations', 'code']]) {
  const seen = new Set();
  for (const item of state[key]) {
    if (seen.has(item[field])) {
      console.error(`«${item[field]}» está repetido en ${key}; revisa la copia antes de importar.`);
      process.exit(1);
    }
    seen.add(item[field]);
  }
}

const store = getPostgresWarehouseStore();
const current = await store.read();
const occupied = COLLECTIONS.some((key) => key !== 'tasks' && current.state[key].length > 0);
if (occupied && !force) {
  console.error(
    `La base de datos ya tiene datos (revisión ${current.revision}: `
    + `${current.state.products.length} referencias, ${current.state.locations.length} ubicaciones, `
    + `${current.state.movements.length} movimientos). Repite con --force para sobrescribirla.`,
  );
  process.exit(1);
}

if (!await store.write(current.revision, state)) {
  console.error('Otro cambio se guardó durante la importación. Vuelve a intentarlo.');
  process.exit(1);
}

const after = await store.read();
console.log(
  `Importado. Revisión ${after.revision}: `
  + COLLECTIONS.map((key) => `${after.state[key].length} ${key}`).join(', '),
);
process.exit(0);
