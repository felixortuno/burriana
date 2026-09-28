'use client';
import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';

export type ReadReference = { sku: string; name: string; family: string; note: string };

export default function ReferencePhoto(
  { disabled, onRead }: { disabled?: boolean; onRead: (read: ReadReference) => void },
) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function send(file: File) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const body = new FormData();
      body.append('foto', file);
      const res = await fetch('/api/reference-photo', { method: 'POST', body });
      const read = await res.json() as ReadReference & { error?: string };
      if (!res.ok) {
        setError(read.error ?? 'No se ha podido leer la foto.');
        return;
      }
      onRead(read);
      setNote(read.note || '');
    } catch {
      setError('Sin conexión. Comprueba la red y vuelve a intentarlo.');
    } finally {
      setBusy(false);
      // Let the same label be photographed twice in a row.
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="photo-read">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) void send(file);
        }}
      />
      <button
        type="button"
        className="photo-button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 size={17} className="spin" /> : <Camera size={17} />}
        {busy ? 'Leyendo la etiqueta…' : 'Leer etiqueta con la cámara'}
      </button>
      <p className="photo-help">
        Rellena los campos a partir de la foto. Compruébalos antes de guardar: un dígito mal leído
        se arrastra a todo el inventario.
      </p>
      {note && <p className="photo-note" role="status">{note}</p>}
      {error && <p className="photo-error" role="alert">{error}</p>}
    </div>
  );
}
