import { authorizeRequest, validateMutationOrigin } from '@/lib/server/access';
import {
  ACCEPTED_TYPES,
  MAX_PHOTO_BYTES,
  readReferencePhoto,
} from '@/lib/server/reference-photo';

export const dynamic = 'force-dynamic';
// Reading a label takes longer than the app's other routes.
export const maxDuration = 60;

const noStore = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: noStore });

export async function POST(request: Request) {
  const denied = await authorizeRequest(request.headers);
  if (denied) return denied;
  const originDenied = validateMutationOrigin(request);
  if (originDenied) return originDenied;

  let photo: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get('foto');
    if (value instanceof File) photo = value;
  } catch {
    return json({ error: 'No se ha podido leer la foto.' }, 400);
  }
  if (!photo) return json({ error: 'Adjunta una foto de la etiqueta.' }, 400);

  if (photo.size > MAX_PHOTO_BYTES) {
    return json({ error: 'La foto pesa demasiado. Hazla de nuevo con menos resolución.' }, 413);
  }
  const mediaType = photo.type.toLowerCase();
  if (!ACCEPTED_TYPES.includes(mediaType)) {
    return json({ error: 'Formato no admitido. Usa una foto JPG o PNG.' }, 415);
  }

  try {
    const data = new Uint8Array(await photo.arrayBuffer());
    const read = await readReferencePhoto(data, mediaType);
    if (!read.legible) {
      return json({
        error: read.note || 'No se lee la etiqueta. Acércate y evita reflejos.',
      }, 422);
    }
    return json(read);
  } catch (error) {
    // Provider errors carry the prompt and credentials in their body, so log only
    // the error name and status: enough to tell a misconfigured account from a
    // model failure, without writing the photo or the key into the logs.
    const status = (error as { statusCode?: number } | null)?.statusCode;
    console.error(
      'reference photo failed',
      error instanceof Error ? error.name : 'unknown',
      status ?? '',
    );
    return json({ error: 'No se ha podido leer la foto. Inténtalo de nuevo.' }, 503);
  }
}
