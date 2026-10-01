import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { BRAND } from './config';

/**
 * Everything printed on the truck and the cube is drawn here at runtime: no
 * image downloads, always the brand's own geometry and fonts.
 */

// The emblem, in the 100×100 units of logo/emblema-*.svg, split into the five
// strokes that light up in turn. Lengths let each one draw itself on.
const STROKES: { d: string[]; length: number }[] = [
  { d: ['M5 5H95V95H5Z'], length: 360 },
  { d: ['M5 30H95'], length: 90 },
  { d: ['M50 5V95'], length: 90 },
  { d: ['M50 5L5 95', 'M50 5L95 95'], length: 100.7 },
  { d: ['M5 52A53 53 0 0 0 95 52'], length: 107.6 },
];
let paths: Path2D[][] | null = null;
const strokePaths = () => (paths ??= STROKES.map(stroke => stroke.d.map(d => new Path2D(d))));

/** Draws the emblem at (x, y) top-left, `size` px wide; `progress` per stroke draws it partially. */
export function drawEmblem(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, progress?: readonly number[]) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.beginPath();
  ctx.rect(2.25, 2.25, 95.5, 95.5);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 5.5;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  strokePaths().forEach((group, i) => {
    const amount = progress ? progress[i] : 1;
    if (amount <= 0) return;
    const length = STROKES[i].length;
    ctx.setLineDash(amount >= 1 ? [] : [length * amount, length * 2]);
    group.forEach(path => ctx.stroke(path));
  });
  ctx.restore();
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return { element, ctx: element.getContext('2d')! };
}

function texture(element: HTMLCanvasElement, color = true, anisotropy = 8): CanvasTexture {
  const result = new CanvasTexture(element);
  if (color) result.colorSpace = SRGBColorSpace;
  result.anisotropy = anisotropy;
  return result;
}

/** Fine grain so painted panels don't look like flat colour. */
function grain(ctx: CanvasRenderingContext2D, width: number, height: number, amount: number, seed = 1) {
  const image = ctx.getImageData(0, 0, width, height);
  let s = seed;
  for (let i = 0; i < image.data.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const n = ((s / 2147483647) - 0.5) * amount;
    image.data[i] += n; image.data[i + 1] += n; image.data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

/** Font stacks next/font registered for the brand faces. */
export function brandFonts() {
  const style = getComputedStyle(document.documentElement);
  return {
    lato: style.getPropertyValue('--font-lato').trim() || 'Lato, system-ui, sans-serif',
    poppins: style.getPropertyValue('--font-poppins').trim() || 'Poppins, system-ui, sans-serif',
  };
}

let fontsLoading: Promise<void> | null = null;
/** Canvas text needs the faces loaded first, or it silently falls back. */
export function loadBrandFonts() {
  if (!fontsLoading) {
    const { lato, poppins } = brandFonts();
    fontsLoading = Promise.all([document.fonts.load(`300 64px ${lato}`), document.fonts.load(`500 64px ${poppins}`)])
      .then(() => undefined, () => undefined);
  }
  return fontsLoading;
}

/** Rear doors: the area of both doors, in metres, mapped to one canvas. */
export const DOOR_AREA = { left: -1.215, right: 1.215, bottom: 1.3, top: 3.86 };
const EMBLEM_CENTER_Y = 2.78, EMBLEM_SIZE = 1.22, WORDMARK_Y = 1.86;

function doorLayout(width: number, height: number) {
  const pxPerM = height / (DOOR_AREA.top - DOOR_AREA.bottom);
  const size = EMBLEM_SIZE * pxPerM;
  return { pxPerM, size, x: width / 2 - size / 2, y: (DOOR_AREA.top - EMBLEM_CENTER_Y) * pxPerM - size / 2 };
}

/** Door paint with the lima emblem and the wordmark, as one texture split between both doors. */
export function doorPaint(height: number) {
  const width = Math.round(height * (DOOR_AREA.right - DOOR_AREA.left) / (DOOR_AREA.top - DOOR_AREA.bottom));
  const { element, ctx } = canvas(width, height);
  const { pxPerM, size, x, y } = doorLayout(width, height);
  ctx.fillStyle = BRAND.negro;
  ctx.fillRect(0, 0, width, height);
  grain(ctx, width, height, 7, 3);
  // Two pressed ribs near top and bottom, like real composite door panels.
  for (const at of [0.1, 0.9]) {
    const gradient = ctx.createLinearGradient(0, height * at - 10, 0, height * at + 10);
    gradient.addColorStop(0, 'rgba(255,255,255,0)'); gradient.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.25)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height * at - 10, width, 20);
  }
  drawEmblem(ctx, x, y, size, BRAND.lima);
  const { lato } = brandFonts();
  ctx.fillStyle = BRAND.lima;
  ctx.font = `300 ${Math.round(0.17 * pxPerM)}px ${lato}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(0.03 * pxPerM)}px`;
  ctx.fillText('GRUPO TRIMODOS', width / 2, (DOOR_AREA.top - WORDMARK_Y) * pxPerM);
  return texture(element);
}

/**
 * The emissive mask of the door emblem. `draw` repaints only when the strokes
 * changed, so it uploads during the second it animates and never again.
 */
export function doorGlow(height: number) {
  const width = Math.round(height * (DOOR_AREA.right - DOOR_AREA.left) / (DOOR_AREA.top - DOOR_AREA.bottom));
  const { element, ctx } = canvas(width, height);
  const result = texture(element, true, 4);
  const { size, x, y } = doorLayout(width, height);
  let last = '';
  const draw = (strokes: readonly number[]) => {
    const key = strokes.map(value => value.toFixed(3)).join();
    if (key === last) return;
    last = key;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    drawEmblem(ctx, x, y, size, '#fff', strokes);
    result.needsUpdate = true;
  };
  draw([0, 0, 0, 0, 0]);
  return { texture: result, draw };
}

/** Trailer side: «GRUPO TRIMODOS» in Lato Light, dark on light, with the four brand colours. */
export function sidePaint(width: number, lengthM: number, heightM: number) {
  const height = Math.round(width * heightM / lengthM);
  const { element, ctx } = canvas(width, height);
  const m = width / lengthM;
  ctx.fillStyle = '#ECECE6';
  ctx.fillRect(0, 0, width, height);
  // Panel joints every metre and a soft dirt gradient towards the bottom.
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let at = 1; at < lengthM; at += 1.02) ctx.fillRect(Math.round(at * m), 0, Math.max(1, Math.round(0.006 * m)), height);
  const dirt = ctx.createLinearGradient(0, height * 0.7, 0, height);
  dirt.addColorStop(0, 'rgba(60,55,45,0)'); dirt.addColorStop(1, 'rgba(60,55,45,0.14)');
  ctx.fillStyle = dirt;
  ctx.fillRect(0, 0, width, height);
  grain(ctx, width, height, 5, 11);

  const { lato } = brandFonts();
  const emblem = 1.18 * m;
  ctx.font = `300 ${Math.round(0.62 * m)}px ${lato}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(0.07 * m)}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const title = 'GRUPO TRIMODOS';
  const textWidth = ctx.measureText(title).width;
  const total = emblem + 0.5 * m + textWidth;
  const left = (width - total) / 2;
  const middle = height * 0.44;
  drawEmblem(ctx, left, middle - emblem / 2, emblem, BRAND.negro);
  ctx.fillStyle = BRAND.negro;
  ctx.fillText(title, left + emblem + 0.5 * m, middle + 0.12 * m);
  ctx.font = `300 ${Math.round(0.2 * m)}px ${lato}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(0.035 * m)}px`;
  ctx.fillStyle = '#5b5b55';
  ctx.fillText('CARTONAJE · TRANSPORTE · LOGÍSTICA', left + emblem + 0.52 * m, middle + 0.5 * m);

  const colors = [BRAND.lima, BRAND.azul, BRAND.naranja, BRAND.turquesa];
  const stripe = 0.13 * m, gap = 0.04 * m, bottom = height - 0.16 * m;
  const segment = (width - gap * 3) / 4;
  colors.forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(i * (segment + gap), bottom - stripe, segment, stripe); });
  return texture(element);
}

/** The loader cube's six faces, in BoxGeometry order: right, left, top, bottom, front, back. */
export function cubeFaces(size = 512) {
  const { lato, poppins } = brandFonts();
  const face = (background: string, paint: (ctx: CanvasRenderingContext2D) => void) => {
    const { element, ctx } = canvas(size, size);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
    paint(ctx);
    const shade = ctx.createLinearGradient(0, size * 0.82, 0, size);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = size * 0.008;
    ctx.strokeRect(0, 0, size, size);
    return texture(element);
  };
  const base = size * 0.135, bottom = size * (1 - 0.26);
  const company = (name: string, color: string) => face(color, ctx => {
    ctx.fillStyle = '#fff';
    ctx.font = `500 ${Math.round(base)}px ${poppins}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${-0.01 * base}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, size / 2, bottom);
  });
  const emblem = face(BRAND.negro, ctx => drawEmblem(ctx, size * 0.18, size * 0.18, size * 0.64, BRAND.lima));
  const front = face(BRAND.lima, ctx => {
    ctx.fillStyle = BRAND.negro;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `300 ${Math.round(base * 0.9)}px ${lato}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${0.06 * base * 0.9}px`;
    ctx.fillText('TRIMODOS', size * 0.18, bottom);
    ctx.font = `300 ${Math.round(base * 0.48)}px ${lato}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${0.08 * base * 0.48}px`;
    ctx.fillText('GRUPO', size * 0.18 + base * 0.06, bottom - base * 0.9 - base * 0.06);
  });
  return [company('Intraser.', BRAND.azul), company('Stinsa.', BRAND.turquesa), emblem, emblem.clone(), front, company('Transargi.', BRAND.naranja)];
}

/** Dashed lane line: 3.5 m of paint every 12.5 m, as a repeating alpha mask. */
export function dashMask() {
  const { element, ctx } = canvas(4, 128);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 4, 128);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 4, Math.round(128 * 3.5 / 12.5));
  const result = texture(element, false, 8);
  result.wrapS = ClampToEdgeWrapping;
  result.wrapT = RepeatWrapping;
  return result;
}

/** Soft round pool of light, for the streetlights on the wet road. */
export function lightPool() {
  const { element, ctx } = canvas(128, 128);
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return texture(element, false, 1);
}

/** Corrugated cardboard boxes stacked on a pallet, 1.2 m square per tile. */
export function cartonBoxes() {
  const size = 512;
  const { element, ctx } = canvas(size, size);
  ctx.fillStyle = BRAND.carton;
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, size, 18, 5);
  const cols = 3, rows = 4;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c * size) / cols, y = (r * size) / rows, w = size / cols, h = size / rows;
    ctx.fillStyle = `rgba(0,0,0,${0.04 + ((r * 7 + c * 3) % 5) * 0.015})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(60,35,10,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.fillStyle = 'rgba(214,180,128,0.55)';
    ctx.fillRect(x + w / 2 - 7, y, 14, h); // tape
  }
  const result = texture(element);
  result.wrapS = result.wrapT = RepeatWrapping;
  return result;
}

/** Spanish trailer plate: red, black characters. */
export function trailerPlate() {
  const { element, ctx } = canvas(256, 56);
  ctx.fillStyle = '#c4161c';
  ctx.fillRect(0, 0, 256, 56);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 252, 52);
  ctx.fillStyle = '#111';
  ctx.font = '600 38px "DIN Alternate", "Arial Narrow", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R 4721 BBX', 128, 30);
  return texture(element, true, 4);
}

/** Red and white conspicuity stripes for the rear bumper. */
export function warningStripes() {
  const { element, ctx } = canvas(256, 32);
  ctx.fillStyle = '#f3f3ee';
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = '#d0141d';
  for (let x = -32; x < 256; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 32); ctx.lineTo(x + 16, 32); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 16, 0);
    ctx.closePath();
    ctx.fill();
  }
  return texture(element, true, 4);
}

/** Far hills as one silhouette strip around the horizon. */
export function hills(): Texture {
  const width = 2048, height = 256;
  const { element, ctx } = canvas(width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  const ridge = (base: number, amplitude: number, seed: number) => {
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 8) {
      const t = (x / width) * Math.PI * 2;
      const y = base - amplitude * (0.55 * Math.sin(t * 3 + seed) + 0.3 * Math.sin(t * 7 + seed * 2) + 0.15 * Math.sin(t * 17 + seed * 3));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  };
  ridge(height * 0.62, height * 0.22, 1.3);
  const result = texture(element, false, 4);
  result.wrapS = RepeatWrapping;
  return result;
}
