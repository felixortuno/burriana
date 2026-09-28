import { generateText, Output } from 'ai';
import { z } from 'zod';

// Vision reads the label; a person always confirms before anything is saved.
const MODEL = 'anthropic/claude-sonnet-5';

export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const extraction = z.object({
  legible: z
    .boolean()
    .describe('false si la foto no muestra una etiqueta o no se puede leer nada fiable'),
  sku: z
    .string()
    .describe('El código de referencia tal cual aparece impreso, sin inventar. Vacío si no se ve.'),
  name: z
    .string()
    .describe('Descripción del producto, incluidas medidas si aparecen. Vacío si no se ve.'),
  family: z
    .string()
    .describe('"Cartón" para planchas y material de cartón, "Cajas" para cajas montadas o plegadas.'),
  note: z
    .string()
    .describe('Qué impide leerlo, o qué campo ha quedado dudoso. Vacío si todo se lee con claridad.'),
});

export type ReferenceExtraction = z.infer<typeof extraction>;

const SYSTEM = `Lees etiquetas de material de almacén en un almacén de cartón y cajas en España.

Transcribe únicamente lo que está impreso en la etiqueta. Nunca completes ni corrijas un código
por lo que te parezca más probable: un dígito mal transcrito convierte el inventario en basura.

Si un campo no se lee con seguridad, déjalo vacío y explica en "note" qué falta. Si la foto está
borrosa, cortada o no muestra una etiqueta, pon legible en false.

Responde en español.`;

export async function readReferencePhoto(
  data: Uint8Array,
  mediaType: string,
): Promise<ReferenceExtraction> {
  const { output } = await generateText({
    model: MODEL,
    system: SYSTEM,
    output: Output.object({ schema: extraction }),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Lee esta etiqueta y extrae la referencia, la descripción y la familia.',
          },
          { type: 'file', mediaType, data },
        ],
      },
    ],
  });
  return output;
}
