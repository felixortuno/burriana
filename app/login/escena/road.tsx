'use client';
import { MeshReflectorMaterial, useEnvironment, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending, BackSide, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, Quaternion, RepeatWrapping, Shape, ShaderMaterial,
  SRGBColorSpace, Vector3, type Material, type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ASSETS, LIGHTS, SKY } from './config';
import type { Rig } from './intro-timeline';
import { dashMask, hills, lightPool } from './textures';

/*
 * Two carriageways with a concrete median, endless because nothing really moves
 * forward: textures scroll and roadside objects are recycled through a window
 * around the camera. Everything past ~200 m dissolves into the fog.
 */
const ROAD = { left: -16.2, right: 4.45, near: 40, far: -360 };
const WINDOW = { near: 34, far: -236 };
const TILE = 3.2;
const DASH = 12.5;
const LAMP = { spacing: 34, height: 10.4, ours: -3.9, theirs: -8.7, pole: -6.3 };

const wrap = (value: number, size: number) => ((value % size) + size) % size;
const hash = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

function merged(parts: BufferGeometry[]) {
  return mergeGeometries(parts.map(part => { const g = part.index ? part.toNonIndexed() : part; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }), false)!;
}

function instanced(geometry: BufferGeometry, material: Material, count: number, shadows = false) {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

/**
 * Repeated objects along the road. Object n sits at near − n·spacing + distance,
 * so it slides towards the camera; the slots only show the ones inside the window.
 */
function recycle(distance: number, spacing: number, place: (index: number, z: number) => void) {
  const count = slots(spacing);
  const base = Math.floor(distance / spacing), shift = wrap(distance, spacing);
  for (let i = 0; i < count; i++) place(base + 1 + i, WINDOW.near - (i + 1) * spacing + shift);
}
const slots = (spacing: number) => Math.ceil((WINDOW.near - WINDOW.far) / spacing);

/** W-beam guardrail profile, extruded along the road. */
function guardrailGeometry() {
  const shape = new Shape();
  const steps = 24, height = 0.31, depth = 0.085, thickness = 0.006;
  const point = (i: number) => { const y = -height / 2 + (i / steps) * height; return [depth / 2 * (1 - Math.cos((2 * Math.PI * (y + height / 2)) / (height / 2))), y]; };
  shape.moveTo(...(point(0) as [number, number]));
  for (let i = 1; i <= steps; i++) shape.lineTo(...(point(i) as [number, number]));
  for (let i = steps; i >= 0; i--) { const [x, y] = point(i); shape.lineTo(x - thickness, y); }
  return new ExtrudeGeometry(shape, { depth: ROAD.near - ROAD.far, bevelEnabled: false, steps: 1 });
}

/** New Jersey concrete barrier for the median. */
function barrierGeometry() {
  const shape = new Shape();
  const points: [number, number][] = [[-0.3, 0], [-0.3, 0.075], [-0.2, 0.33], [-0.075, 0.81], [0.075, 0.81], [0.2, 0.33], [0.3, 0.075], [0.3, 0]];
  shape.moveTo(...points[0]);
  points.slice(1).forEach(p => shape.lineTo(...p));
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth: ROAD.near - ROAD.far, bevelEnabled: false, steps: 1 });
}

function Sky() {
  const material = useMemo(() => new ShaderMaterial({
    side: BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new Color(SKY.zenith) }, middle: { value: new Color(SKY.middle) }, horizon: { value: new Color(SKY.horizon) },
      glow: { value: new Color(SKY.glow) }, ground: { value: new Color(SKY.fog) }, glowDir: { value: new Vector3(-0.35, 0, -1).normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 zenith, middle, horizon, glow, ground, glowDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 color = mix(horizon, middle, smoothstep(0.0, 0.16, h));
        color = mix(color, zenith, smoothstep(0.12, 0.75, h));
        float toward = max(dot(normalize(vec3(d.x, 0.0, d.z)), glowDir), 0.0);
        color += glow * pow(toward, 5.0) * (1.0 - smoothstep(-0.02, 0.28, h)) * 0.6;
        color = mix(color, ground, smoothstep(0.0, -0.04, h));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }), []);
  const ridge = useMemo(() => hills(), []);
  useEffect(() => () => { material.dispose(); ridge.dispose(); }, [material, ridge]);
  return <group>
    <mesh material={material} renderOrder={-2}><sphereGeometry args={[560, 32, 16]} /></mesh>
    <mesh position={[0, 6, 0]} renderOrder={-1}>
      <cylinderGeometry args={[520, 520, 70, 64, 1, true]} />
      <meshBasicMaterial color="#1d2445" alphaMap={ridge} alphaMap-repeat={[3, 1]} transparent side={BackSide} fog={false} depthWrite={false} />
    </mesh>
  </group>;
}

/** Builds the road once its maps are loaded; `update` moves everything each frame. */
function buildRoad(color: Texture, normal: Texture, roughness: Texture, environment: Texture) {
  const width = ROAD.right - ROAD.left, length = ROAD.near - ROAD.far;
  // Asphalt maps share one tiling; colour textures stay in sRGB.
  color.colorSpace = SRGBColorSpace;
  for (const map of [color, normal, roughness]) {
    map.wrapS = map.wrapT = RepeatWrapping;
    map.repeat.set(width / TILE, length / TILE);
    map.anisotropy = 8;
    map.needsUpdate = true;
  }
  const lines = dashMask();
  lines.repeat.set(1, length / DASH);
  const ground = color.clone();
  const concrete = color.clone();
  const pool = lightPool();
  const mat = {
    line: new MeshStandardMaterial({ color: '#e6e6de', roughness: 0.45, emissive: new Color('#ffffff'), emissiveIntensity: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    dash: new MeshStandardMaterial({ color: '#e6e6de', roughness: 0.45, emissive: new Color('#ffffff'), emissiveIntensity: 0.05, alphaMap: lines, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    grass: new MeshStandardMaterial({ color: '#1d2620', map: ground, roughness: 1 }),
    concrete: new MeshStandardMaterial({ color: '#77746e', map: concrete, roughness: 0.85 }),
    rail: new MeshStandardMaterial({ color: '#80878e', metalness: 0.6, roughness: 0.45, side: DoubleSide }),
    post: new MeshStandardMaterial({ color: '#6f757b', metalness: 0.7, roughness: 0.5 }),
    white: new MeshStandardMaterial({ color: '#e8e8e2', roughness: 0.6 }),
    black: new MeshStandardMaterial({ color: '#141414', roughness: 0.6 }),
    amber: new MeshStandardMaterial({ color: '#3a2104', emissive: new Color('#ffa31f'), emissiveIntensity: 2.2 }),
    clear: new MeshStandardMaterial({ color: '#333333', emissive: new Color('#e6eeff'), emissiveIntensity: 1.6 }),
    pole: new MeshStandardMaterial({ color: '#5a5e63', metalness: 0.6, roughness: 0.5 }),
    lamp: new MeshStandardMaterial({ color: '#40301c', emissive: new Color(LIGHTS.sodium), emissiveIntensity: 9 }),
    pool: new MeshBasicMaterial({ color: new Color(LIGHTS.sodium).multiplyScalar(0.6), map: pool, transparent: true, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    tree: new MeshBasicMaterial({ color: '#0b1120' }),
    car: new MeshStandardMaterial({ color: '#0d0e10', roughness: 0.4, metalness: 0.5 }),
    headlight: new MeshStandardMaterial({ color: '#ffffff', emissive: new Color('#fff3dc'), emissiveIntensity: 14 }),
  };
  const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new BoxGeometry(w, h, d).translate(x, y, z);
  const cylinder = (r: number, h: number, x = 0, y = 0, z = 0, rotZ = 0) => new CylinderGeometry(r, r, h, 10).rotateZ(rotZ).translate(x, y, z);

  // Static strips: lines, rails, median, verges.
  const statics = new Object3D();
  const strip = (geometry: BufferGeometry, material: Material, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], receive = false) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.receiveShadow = receive;
    statics.add(mesh);
  };
  const flat = (w: number) => new PlaneGeometry(w, length).rotateX(-Math.PI / 2);
  const z0 = (ROAD.near + ROAD.far) / 2;
  // three ignores envMapIntensity under scene.environment, so the roadside gets
  // the sky explicitly and reflects less of it than the truck does.
  for (const [material, intensity] of [[mat.rail, 0.45], [mat.concrete, 0.3], [mat.grass, 0.25], [mat.post, 0.4], [mat.white, 0.5], [mat.line, 0.35], [mat.dash, 0.35]] as const) {
    material.envMap = environment;
    material.envMapIntensity = intensity;
  }
  for (const x of [1.85]) strip(flat(0.25), mat.line, [x, 0.006, z0]);
  for (const x of [-5.4, -7.1, -15.4]) strip(flat(0.15), mat.line, [x, 0.006, z0]);
  for (const x of [-1.75, -11.25]) strip(flat(0.15), mat.dash, [x, 0.006, z0]);
  strip(guardrailGeometry(), mat.rail, [4.62, 0.62, ROAD.near], [0, Math.PI, 0]);
  strip(guardrailGeometry(), mat.rail, [-15.95, 0.62, ROAD.far]);
  const barrier = barrierGeometry();
  strip(barrier, mat.concrete, [LAMP.pole, 0, ROAD.far], [0, 0, 0], true);
  strip(flat(70), mat.grass, [ROAD.right + 35, -0.02, z0], [0, 0, 0], true);
  strip(flat(70), mat.grass, [ROAD.left - 35, -0.02, z0], [0, 0, 0], true);

  // Recycled roadside objects.
  const postGeometry = merged([box(0.1, 0.78, 0.16, 0, 0.39, 0), box(0.16, 0.3, 0.1, -0.11, 0.62, 0)]);
  const posts = { right: instanced(postGeometry, mat.post, slots(4)), left: instanced(postGeometry, mat.post, slots(4)) };
  const reflectors = { right: instanced(box(0.04, 0.09, 0.03), mat.amber, slots(12)), left: instanced(box(0.04, 0.09, 0.03), mat.clear, slots(12)) };
  const delineators = {
    body: instanced(merged([box(0.1, 1.05, 0.12, 0, 0.525, 0)]), mat.white, slots(50)),
    band: instanced(box(0.104, 0.25, 0.124, 0, 0.86, 0), mat.black, slots(50)),
    lens: instanced(box(0.05, 0.12, 0.012, 0, 0.86, 0.064), mat.amber, slots(50)),
  };
  const poleGeometry = merged([
    new CylinderGeometry(0.08, 0.13, LAMP.height, 10).translate(0, LAMP.height / 2, 0),
    cylinder(0.05, LAMP.pole - LAMP.theirs, (LAMP.theirs - LAMP.pole) / 2, LAMP.height - 0.2, 0, Math.PI / 2),
    cylinder(0.05, LAMP.ours - LAMP.pole, (LAMP.ours - LAMP.pole) / 2, LAMP.height - 0.2, 0, Math.PI / 2),
    box(0.8, 0.16, 0.34, LAMP.ours - LAMP.pole, LAMP.height - 0.16, 0),
    box(0.8, 0.16, 0.34, LAMP.theirs - LAMP.pole, LAMP.height - 0.16, 0),
  ]);
  const lampGeometry = merged([box(0.66, 0.03, 0.26, LAMP.ours - LAMP.pole, LAMP.height - 0.25, 0), box(0.66, 0.03, 0.26, LAMP.theirs - LAMP.pole, LAMP.height - 0.25, 0)]);
  const lamps = { pole: instanced(poleGeometry, mat.pole, slots(LAMP.spacing)), lens: instanced(lampGeometry, mat.lamp, slots(LAMP.spacing)) };
  const pools = instanced(new PlaneGeometry(12, 12).rotateX(-Math.PI / 2), mat.pool, slots(LAMP.spacing) * 2);
  // Firs as three stacked cones: dark silhouettes against the dusk.
  const treeGeometry = merged([
    new CylinderGeometry(0.14, 0.18, 1.4, 6).translate(0, 0.7, 0),
    new ConeGeometry(1.7, 3.6, 8).translate(0, 2.9, 0),
    new ConeGeometry(1.3, 3.0, 8).translate(0, 4.4, 0),
    new ConeGeometry(0.85, 2.6, 8).translate(0, 5.9, 0),
  ]);
  const trees = { right: instanced(treeGeometry, mat.tree, slots(9)), left: instanced(treeGeometry, mat.tree, slots(9)) };
  const carGeometry = merged([box(1.8, 0.6, 4.3, 0, 0.55, 0), box(1.6, 0.5, 2.2, 0, 1.05, -0.3)]);
  const lightGeometry = merged([box(0.3, 0.1, 0.05, -0.6, 0.62, 2.16), box(0.3, 0.1, 0.05, 0.6, 0.62, 2.16)]);
  const traffic = { body: instanced(carGeometry, mat.car, 3), lights: instanced(lightGeometry, mat.headlight, 3) };
  const roadside = new Object3D();
  roadside.add(posts.right, posts.left, reflectors.right, reflectors.left, delineators.body, delineators.band, delineators.lens, lamps.pole, lamps.lens, pools, trees.right, trees.left, traffic.body, traffic.lights);

  // Two sodium lights travel with the nearest lamps (one per parity), so the
  // truck is lit as it passes under them without dozens of real lights.
  const sodium = [new PointLight(LIGHTS.sodium, 0, 30, 2), new PointLight(LIGHTS.sodium, 0, 30, 2)];

  ground.wrapS = ground.wrapT = RepeatWrapping;
  ground.repeat.set(70 / 6, length / 6);
  ground.needsUpdate = true;
  concrete.wrapS = concrete.wrapT = RepeatWrapping;
  concrete.repeat.set(1, 1 / 2.5);
  concrete.needsUpdate = true;

  const recycled = [posts.right, posts.left, reflectors.right, reflectors.left, ...Object.values(delineators), lamps.pole, lamps.lens, pools, trees.right, trees.left, traffic.body, traffic.lights];
  const matrix = new Matrix4(), at = new Vector3(), one = new Vector3(1, 1, 1), quaternion = new Quaternion();
  const set = (mesh: InstancedMesh, i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => {
    quaternion.setFromAxisAngle(at.set(0, 1, 0), ry);
    mesh.setMatrixAt(i, matrix.compose(at.set(x, y, z), quaternion, one.set(sx, sy, sz)));
  };
  let oncoming = 0;

  const update = (rig: Rig, delta: number) => {
    const step = Math.min(delta, 0.1);
    rig.distance += rig.speed * step;
    const d = rig.distance;

    // Scrolling surfaces.
    const tile = wrap(d / TILE, 1);
    for (const map of [color, normal, roughness]) map.offset.y = tile;
    ground.offset.y = wrap(d / 6, 1);
    concrete.offset.y = -wrap(d / 2.5, 1);
    lines.offset.y = wrap(d / DASH, 1);

    let i = 0;
    recycle(d, 4, (_, z) => { set(posts.right, i, 4.74, 0, z, 1, 1, 1, Math.PI); set(posts.left, i, -16.07, 0, z); i++; });
    i = 0;
    recycle(d, 12, (_, z) => { set(reflectors.right, i, 4.55, 0.8, z); set(reflectors.left, i, -15.88, 0.8, z); i++; });
    i = 0;
    recycle(d, 50, (_, z) => { for (const mesh of Object.values(delineators)) set(mesh, i, 4.2, 0, z); i++; });
    i = 0;
    recycle(d, LAMP.spacing, (_, z) => {
      set(lamps.pole, i, LAMP.pole, 0, z);
      set(lamps.lens, i, LAMP.pole, 0, z);
      set(pools, i * 2, LAMP.ours, 0.012, z);
      set(pools, i * 2 + 1, LAMP.theirs, 0.012, z);
      i++;
    });
    i = 0;
    recycle(d, 9, (index, z) => {
      const a = hash(index), b = hash(index + 91.7), s = 0.7 + hash(index + 13.1) * 0.8;
      set(trees.right, i, 13 + a * 30, -0.02, z + b * 6, s, s * (0.8 + b * 0.5), s, a * 6);
      set(trees.left, i, -21 - b * 30, -0.02, z + a * 6, s, s * (0.8 + a * 0.5), s, b * 6);
      i++;
    });
    // Oncoming cars on the far carriageway keep going even when the truck stops.
    oncoming += step * 27;
    for (let c = 0; c < 3; c++) {
      const z = WINDOW.far - 80 + wrap(oncoming + d + c * 131, 340);
      const x = c === 1 ? -12.9 : -9.4;
      set(traffic.body, c, x, 0, z);
      set(traffic.lights, c, x, 0, z);
    }
    for (const mesh of recycled) mesh.instanceMatrix.needsUpdate = true;

    // Sodium lights: for each parity, the lamp nearest the middle of the truck.
    const base = Math.floor(d / LAMP.spacing), shift = wrap(d, LAMP.spacing);
    sodium.forEach((light, parity) => {
      let best = Infinity, bestZ = 0;
      for (let k = 1; k <= 8; k++) {
        if ((base + k) % 2 !== parity) continue;
        const z = WINDOW.near - k * LAMP.spacing + shift;
        if (Math.abs(z + 6) < best) { best = Math.abs(z + 6); bestZ = z; }
      }
      light.position.set(LAMP.ours, LAMP.height - 0.5, bestZ);
      light.intensity = 320;
    });
  };

  const dispose = () => {
    [lines, ground, concrete, pool].forEach(texture => texture.dispose());
    Object.values(mat).forEach(material => material.dispose());
    for (const group of [statics, roadside]) group.traverse(object => (object as Mesh).geometry?.dispose());
  };
  return { statics, roadside, sodium, update, dispose, size: { width, length } };
}

export default function Road({ rig, reflector, shadows }: { rig: Rig; reflector: number; shadows: boolean }) {
  const [color, normal, roughness] = useTexture([ASSETS.asphalt.color, ASSETS.asphalt.normal, ASSETS.asphalt.roughness]);
  const environment = useEnvironment({ files: ASSETS.hdri });
  const road = useMemo(() => buildRoad(color, normal, roughness, environment), [color, normal, roughness, environment]);
  useEffect(() => road.dispose, [road]);
  useFrame((_, delta) => road.update(rig, delta));
  const { width, length } = road.size;

  return <group>
    <Sky />
    <mesh rotation-x={-Math.PI / 2} position={[(ROAD.left + ROAD.right) / 2, 0, (ROAD.near + ROAD.far) / 2]} receiveShadow={shadows}>
      <planeGeometry args={[width, length]} />
      {reflector > 0
        ? <MeshReflectorMaterial
            resolution={reflector} blur={[380, 120]} mixBlur={1} mixStrength={0.9} mixContrast={1} mirror={0}
            depthScale={1.1} minDepthThreshold={0.4} maxDepthThreshold={1.25} depthToBlurRatioBias={0.25}
            color="#2a2c31" map={color} normalMap={normal} normalScale={[0.5, 0.5]} roughnessMap={roughness} roughness={1} metalness={0.05} envMap={environment} envMapIntensity={0.14} />
        : <meshStandardMaterial color="#2a2c31" map={color} normalMap={normal} normalScale={[0.5, 0.5]} roughnessMap={roughness} roughness={1} metalness={0.05} envMap={environment} envMapIntensity={0.18} />}
    </mesh>
    <primitive object={road.statics} />
    <primitive object={road.roadside} />
    {road.sodium.map((light, i) => <primitive key={i} object={light} />)}
  </group>;
}

