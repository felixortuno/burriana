'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cajasSlots, cartonSlots, layoutWarehouse, PLAN_SCALE, PLAN_SIZE, planFeatures, type Stack } from '@/lib/warehouse-layout';
import { formatPallets, modelKey } from '@/lib/warehouse-insights';
import type { State } from '@/lib/warehouse';

export type ColorMode = 'tipo' | 'modelo' | 'revisar';
export type CameraPreset = 'perspectiva' | 'planta' | 'carton' | 'cajas';

type Props = {
  data: State;
  colorMode: ColorMode;
  review: Set<string>;
  highlight?: Set<string> | null;
  selected?: string | null;
  onSelect?: (locationId: string | null) => void;
  preset: CameraPreset;
  /** Changes to re-apply the same preset after the person moved the camera. */
  presetNonce?: number;
  interactive?: boolean;
};

const S = PLAN_SCALE;
const world = (x: number, y: number) => new THREE.Vector3((x - PLAN_SIZE.width / 2) * S, 0, (y - PLAN_SIZE.depth / 2) * S);
const LOAD = { carton: 1.0, montaje: 1.25 } as const;
const BASE = 0.14;
const FOOTPRINT = 1.08;

const COLORS = {
  carton: '#b8946a',
  montaje: '#7472e0',
  review: '#ff9f0a',
  quiet: '#d1d1d6',
  ghost: '#ececf0',
  pallet: '#c9b79c',
};
const MODEL_PALETTE = ['#6b93d6', '#d69563', '#6fb38c', '#b383d1', '#cdb35b', '#5fb2b8', '#d47f97', '#8b8fd8', '#9db35f', '#c9976a', '#7aa6a0', '#c27ac0'];

const PRESETS: Record<CameraPreset, { target: [number, number]; offset: [number, number, number] }> = {
  perspectiva: { target: [990, 590], offset: [12, 66, 82] },
  planta: { target: [990, 566], offset: [0, 112, 0.01] },
  carton: { target: [420, 300], offset: [10, 26, 30] },
  cajas: { target: [1150, 920], offset: [8, 30, 36] },
};

type Scene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  stock: THREE.Group;
  loads?: THREE.InstancedMesh;
  bases?: THREE.InstancedMesh;
  instanceStack: Stack[];
  dirty: boolean;
  /** False until the first view is applied; that one is set without gliding. */
  placed: boolean;
  dispose: () => void;
};

function glide(state: Scene, toTarget: THREE.Vector3, toPosition: THREE.Vector3) {
  const fromTarget = state.controls.target.clone();
  const fromPosition = state.camera.position.clone();
  if (!state.placed || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    state.placed = true;
    state.camera.position.copy(toPosition);
    state.controls.target.copy(toTarget);
    state.controls.update();
    state.dirty = true;
    return;
  }
  let frame = 0;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 750);
    const k = 1 - Math.pow(1 - t, 3);
    state.camera.position.lerpVectors(fromPosition, toPosition, k);
    state.controls.target.lerpVectors(fromTarget, toTarget, k);
    state.dirty = true;
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

export default function Warehouse3D({ data, colorMode, review, highlight, selected, onSelect, preset, presetNonce = 0, interactive = true }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const labels = useRef<Record<string, HTMLSpanElement | null>>({});
  const scene = useRef<Scene | null>(null);
  const hovered = useRef<string | null>(null);
  const [hover, setHover] = useState<Stack | null>(null);
  const [failed, setFailed] = useState(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  const layout = useMemo(() => layoutWarehouse(data.locations), [data.locations]);
  const products = useMemo(() => new Map(data.products.map(product => [product.sku, product])), [data.products]);
  const locations = useMemo(() => new Map(data.locations.map(location => [location.id, location])), [data.locations]);
  const modelColors = useMemo(() => {
    const keys = [...new Set(data.products.map(product => modelKey(product.sku)))].sort();
    return new Map(keys.map((key, i) => [key, MODEL_PALETTE[i % MODEL_PALETTE.length]]));
  }, [data.products]);

  // One renderer for the lifetime of the component; stock is rebuilt separately.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      Promise.resolve().then(() => setFailed(true));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.domElement.className = 'w3d-canvas';
    element.prepend(renderer.domElement);

    const three = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.minDistance = 6;
    controls.maxDistance = 330;

    three.add(new THREE.HemisphereLight('#ffffff', '#d8d8de', 1.9));
    const sun = new THREE.DirectionalLight('#ffffff', 2.1);
    sun.position.set(-34, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 40, bottom: -40, near: 1, far: 200 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0004;
    three.add(sun);

    const disposables: { dispose: () => void }[] = [];
    const material = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
      disposables.push(m);
      return m;
    };
    const box = (w: number, h: number, d: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      disposables.push(g);
      return g;
    };
    const solid = (rect: { x: number; y: number; w: number; h: number }, height: number, color: string) => {
      const mesh = new THREE.Mesh(box(rect.w * S, height, rect.h * S), material(color));
      const center = world(rect.x + rect.w / 2, rect.y + rect.h / 2);
      mesh.position.set(center.x, height / 2, center.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      three.add(mesh);
    };

    // Floor of the building, a cut-away model: walls are kept low so the stock stays visible.
    const { outer } = planFeatures;
    const floor = new THREE.Mesh(box(outer.w * S, 0.2, outer.h * S), material('#fbfbfd'));
    const floorCenter = world(outer.x + outer.w / 2, outer.y + outer.h / 2);
    floor.position.set(floorCenter.x, -0.1, floorCenter.z);
    floor.receiveShadow = true;
    three.add(floor);

    const wallMaterial = material('#ffffff');
    const wall = (x1: number, y1: number, x2: number, y2: number, height: number) => {
      const a = world(x1, y1), b = world(x2, y2);
      const length = a.distanceTo(b) + 0.3;
      const mesh = new THREE.Mesh(box(length, height, 0.3), wallMaterial);
      mesh.position.set((a.x + b.x) / 2, height / 2, (a.z + b.z) / 2);
      mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      three.add(mesh);
    };
    const { x, y, w, h } = outer;
    for (const [x1, y1, x2, y2] of [[x, y, x + w, y], [x, y, x, y + h], [x + w, y, x + w, y + h], [x, y + h, x + w, y + h]]) wall(x1, y1, x2, y2, 0.9);
    for (const [x1, y1, x2, y2] of planFeatures.cartonWalls) wall(x1, y1, x2, y2, 1.3);
    solid(planFeatures.offices, planFeatures.offices.height, '#f2f2f5');
    for (const machine of planFeatures.machines) solid(machine, machine.height, '#dcdce1');
    for (const pillar of planFeatures.pillars) solid({ x: pillar.x, y: pillar.y, w: 9, h: 9 }, 1.3, '#e6e6ea');
    for (const dock of planFeatures.docks) solid(dock, 0.05, '#d6d6db');

    // Every pallet position of the drawing, as a faint floor marking.
    const marks: number[] = [];
    for (const slot of [...cartonSlots, ...cajasSlots]) {
      const a = world(slot.x, slot.y), b = world(slot.x + slot.w, slot.y + slot.h);
      marks.push(a.x, 0.02, a.z, b.x, 0.02, a.z, b.x, 0.02, a.z, b.x, 0.02, b.z, b.x, 0.02, b.z, a.x, 0.02, b.z, a.x, 0.02, b.z, a.x, 0.02, a.z);
    }
    const markGeometry = new THREE.BufferGeometry();
    markGeometry.setAttribute('position', new THREE.Float32BufferAttribute(marks, 3));
    const markMaterial = new THREE.LineBasicMaterial({ color: '#c7c7cc', transparent: true, opacity: 0.7 });
    disposables.push(markGeometry, markMaterial);
    three.add(new THREE.LineSegments(markGeometry, markMaterial));

    const stock = new THREE.Group();
    three.add(stock);

    const state: Scene = { renderer, scene: three, camera, controls, stock, instanceStack: [], dirty: true, placed: false, dispose: () => {} };
    scene.current = state;
    controls.addEventListener('change', () => { state.dirty = true; });

    const resize = () => {
      const { clientWidth, clientHeight } = element;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      state.dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    const projected = new THREE.Vector3();
    const placeLabels = () => {
      const width = element.clientWidth, height = element.clientHeight;
      for (const [key, point] of Object.entries(planFeatures.labels)) {
        const label = labels.current[key];
        if (!label) continue;
        projected.copy(world(point.x, point.y)).setY(key === 'offices' ? 3.4 : 0.1).project(camera);
        const visible = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
        label.style.opacity = visible ? '1' : '0';
        label.style.transform = `translate(-50%, -50%) translate(${(projected.x + 1) / 2 * width}px, ${(1 - projected.y) / 2 * height}px)`;
      }
    };

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const moved = controls.update();
      if (moved || state.dirty) {
        renderer.render(three, camera);
        placeLabels();
        state.dirty = false;
      }
    };
    loop();

    state.dispose = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const item of disposables) item.dispose();
      state.loads?.geometry.dispose();
      state.bases?.geometry.dispose();
      (state.loads?.material as THREE.Material | undefined)?.dispose();
      (state.bases?.material as THREE.Material | undefined)?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    return () => { state.dispose(); scene.current = null; };
  }, []);

  useEffect(() => {
    if (scene.current) scene.current.controls.enabled = interactive;
  }, [interactive]);

  // Pallets: one instance per level, so a partial top pallet can be drawn lower.
  useEffect(() => {
    const state = scene.current;
    if (!state) return;
    for (const mesh of [state.loads, state.bases]) {
      if (!mesh) continue;
      state.stock.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    const count = layout.stacks.reduce((n, stack) => n + stack.levels.length, 0);
    const loads = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 }), Math.max(count, 1));
    const bases = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: COLORS.pallet, roughness: 1 }), Math.max(count, 1));
    loads.castShadow = bases.castShadow = true;
    loads.receiveShadow = bases.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const instanceStack: Stack[] = [];
    let i = 0;
    for (const stack of layout.stacks) {
      const center = world(stack.slot.x + stack.slot.w / 2, stack.slot.y + stack.slot.h / 2);
      const load = LOAD[stack.area];
      stack.levels.forEach((fill, level) => {
        const floorY = level * (BASE + load);
        matrix.compose(new THREE.Vector3(center.x, floorY + BASE / 2, center.z), new THREE.Quaternion(), new THREE.Vector3(FOOTPRINT, BASE * 0.9, FOOTPRINT));
        bases.setMatrixAt(i, matrix);
        const height = load * fill - 0.04;
        matrix.compose(new THREE.Vector3(center.x, floorY + BASE + height / 2, center.z), new THREE.Quaternion(), new THREE.Vector3(FOOTPRINT - 0.06, height, FOOTPRINT - 0.06));
        loads.setMatrixAt(i, matrix);
        instanceStack[i++] = stack;
      });
    }
    loads.count = bases.count = count;
    loads.instanceMatrix.needsUpdate = bases.instanceMatrix.needsUpdate = true;
    loads.computeBoundingSphere();
    bases.computeBoundingSphere();
    state.stock.add(loads, bases);
    Object.assign(state, { loads, bases, instanceStack, dirty: true });
  }, [layout]);

  // Colours follow the mode, the search and the selection without rebuilding geometry.
  useEffect(() => {
    const state = scene.current;
    if (!state?.loads) return;
    const color = new THREE.Color();
    const ghost = new THREE.Color(COLORS.ghost);
    state.instanceStack.forEach((stack, i) => {
      if (colorMode === 'tipo') color.set(COLORS[stack.area]);
      else if (colorMode === 'modelo') color.set(modelColors.get(modelKey(stack.sku)) ?? COLORS.quiet);
      else color.set(review.has(stack.locationId) ? COLORS.review : COLORS.quiet);
      // The selected block keeps its own colour; everything else steps back.
      if (selected) {
        if (stack.locationId !== selected) color.lerp(ghost, 0.88);
        else color.offsetHSL(0, 0.12, -0.04);
      } else if (highlight && !highlight.has(stack.locationId)) color.lerp(ghost, 0.82);
      if (hover?.locationId === stack.locationId) color.offsetHSL(0, 0.04, 0.08);
      state.loads!.setColorAt(i, color);
    });
    if (state.loads.instanceColor) state.loads.instanceColor.needsUpdate = true;
    state.dirty = true;
  }, [layout, colorMode, review, highlight, selected, hover, modelColors]);

  // Camera presets glide unless the person prefers reduced motion.
  useEffect(() => {
    const state = scene.current;
    if (!state) return;
    const { target, offset } = PRESETS[preset];
    const toTarget = world(target[0], target[1]);
    // Wide views back away on narrow screens so the whole building stays in frame.
    const fit = preset === 'perspectiva' || preset === 'planta' ? Math.min(3.6, Math.max(1, 1.95 / state.camera.aspect)) : 1;
    return glide(state, toTarget, toTarget.clone().add(new THREE.Vector3(...offset).multiplyScalar(fit)));
  }, [preset, presetNonce]);

  // Selecting a block (by click, link or search) brings the camera closer, keeping its angle.
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => {
    const state = scene.current;
    if (!state || !selected) return;
    const stacks = layoutRef.current.stacks.filter(stack => stack.locationId === selected);
    if (!stacks.length) return;
    const center = stacks.reduce((sum, stack) => sum.add(world(stack.slot.x + stack.slot.w / 2, stack.slot.y + stack.slot.h / 2)), new THREE.Vector3()).divideScalar(stacks.length);
    const direction = state.camera.position.clone().sub(state.controls.target);
    const distance = Math.min(direction.length(), 42);
    return glide(state, center, center.clone().add(direction.normalize().multiplyScalar(distance)));
  }, [selected]);

  // Pointer picking: hover shows a label, a click (not a drag) selects the block.
  useEffect(() => {
    const element = host.current;
    const state = scene.current;
    if (!element || !state || !interactive) return;
    const canvas = state.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    let pending = 0;
    const pick = (event: PointerEvent): Stack | null => {
      if (!state.loads) return null;
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, state.camera);
      const [hit] = raycaster.intersectObject(state.loads, false);
      return hit?.instanceId !== undefined ? state.instanceStack[hit.instanceId] ?? null : null;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const stack = down ? null : pick(event);
        if (tooltip.current) {
          const rect = element.getBoundingClientRect();
          tooltip.current.style.transform = `translate(${event.clientX - rect.left + 14}px, ${event.clientY - rect.top + 14}px)`;
        }
        if ((stack?.locationId ?? null) !== hovered.current) {
          hovered.current = stack?.locationId ?? null;
          canvas.style.cursor = stack ? 'pointer' : '';
          setHover(stack);
        }
      });
    };
    const leave = () => { hovered.current = null; setHover(null); };
    const press = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
    const release = (event: PointerEvent) => {
      if (!down) return;
      const dragged = Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5;
      down = null;
      if (!dragged) onSelectRef.current?.(pick(event)?.locationId ?? null);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointerdown', press);
    canvas.addEventListener('pointerup', release);
    return () => {
      cancelAnimationFrame(pending);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerdown', press);
      canvas.removeEventListener('pointerup', release);
    };
  }, [interactive]);

  const hoverLocation = hover ? locations.get(hover.locationId) : undefined;
  return <div ref={host} className="w3d">
    {failed && <div className="w3d-fallback"><b>La vista 3D no está disponible</b><p>Este navegador no permite gráficos 3D. Las ubicaciones siguen disponibles en la lista.</p></div>}
    <div className="w3d-labels" aria-hidden="true">
      <span ref={node => { labels.current.carton = node; }}>Almacén de cartón</span>
      <span ref={node => { labels.current.montaje = node; }}>Cajas montadas</span>
      <span ref={node => { labels.current.offices = node; }}>Oficinas</span>
    </div>
    <div ref={tooltip} className={'w3d-tooltip' + (hoverLocation ? ' visible' : '')} aria-hidden="true">
      {hoverLocation && <>
        <b>{products.get(hoverLocation.sku)?.name ?? hoverLocation.sku}</b>
        <span>{hoverLocation.code} · {formatPallets(hoverLocation.qty)} palets</span>
      </>}
    </div>
  </div>;
}
