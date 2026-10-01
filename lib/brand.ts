/**
 * Grupo Trimodos identity. CSS reads the same values from the --tm-* variables
 * in app/globals.css; this object is for places CSS cannot reach (manifest).
 */
export const brand = {
  negro: '#1C1C1A',
  lima: '#D9E33B',
  azul: '#2C49A6',
  naranja: '#EE7B47',
  turquesa: '#4DB9A8',
} as const;

/** One company per side of the cube, in the order the loader turns. */
export const companies = [
  { face: 'frente', name: 'Grupo Trimodos', color: 'lima' },
  { face: 'derecha', name: 'Intraser.', color: 'azul' },
  { face: 'detras', name: 'Transargi.', color: 'naranja' },
  { face: 'izquierda', name: 'Stinsa.', color: 'turquesa' },
] as const;
