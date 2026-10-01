'use client';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  Color, CylinderGeometry, Euler, Group, InstancedMesh, Material, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  Object3D, PlaneGeometry, PointLight, Quaternion, SpotLight, Texture, Vector3, type BufferGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRAND, LIGHTS, TRUCK, type Vec3 } from './config';
import type { Rig } from './intro-timeline';
import { Kit } from './kit';
import { cartonBoxes, DOOR_AREA, doorGlow, doorPaint, sidePaint, trailerPlate, warningStripes } from './textures';

/*
 * A procedural tractor and 13.6 m box semi-trailer, built from merged primitives.
 *
 * To use a real model instead, export it as public/models/truck.glb (meshopt or
 * draco compressed, textures in KTX2/WebP), set ASSETS.truckModel in config.ts
 * and replace <Truck/> with a component that loads it with drei's useGLTF. Scale
 * it so the trailer box measures TRUCK.length along -z with the rear doors at
 * z = 0, and name the door nodes «puerta-izquierda» / «puerta-derecha» with their
 * pivots on the hinges so the intro can still open them.
 */

const HALF = TRUCK.width / 2;
const ROOF = TRUCK.floor + TRUCK.boxHeight;
const BODY = { front: -TRUCK.length, rear: -0.12 };
const TRAILER_AXLES = [-1.9, -3.21, -4.52];
const DOOR = { hinge: 1.215, width: 1.207, bottom: DOOR_AREA.bottom, top: DOOR_AREA.top };

type Detail = 'alta' | 'baja';

function materials(detail: Detail) {
  const high = detail === 'alta';
  const glow = doorGlow(high ? 1024 : 512);
  const standard = (color: string, roughness: number, metalness = 0, extra: Partial<MeshStandardMaterial> = {}) =>
    Object.assign(new MeshStandardMaterial({ color, roughness, metalness }), extra);
  const emissive = (color: string, glowColor: string, intensity: number) =>
    new MeshStandardMaterial({ color, emissive: new Color(glowColor), emissiveIntensity: intensity, roughness: 0.3 });
  return {
    glow,
    side: new MeshPhysicalMaterial({ map: sidePaint(high ? 4096 : 2048, BODY.rear - BODY.front, TRUCK.boxHeight), roughness: 0.36, clearcoat: 0.55, clearcoatRoughness: 0.22 }),
    door: new MeshPhysicalMaterial({
      map: doorPaint(high ? 2048 : 1024), emissiveMap: glow.texture, emissive: new Color(BRAND.lima), emissiveIntensity: 0,
      roughness: 0.42, metalness: 0.22, clearcoat: 0.45, clearcoatRoughness: 0.32,
    }),
    doorInner: standard('#5d6064', 0.55, 0.45),
    white: standard('#dcdcd6', 0.5),
    aluminium: standard('#a9adb2', 0.35, 1, { envMapIntensity: 0.8 }),
    chrome: standard('#c3c7cc', 0.16, 1, { envMapIntensity: 0.7 }),
    steel: standard('#25262a', 0.55, 0.6),
    rubber: standard('#111214', 0.88),
    plastic: standard('#17181a', 0.55),
    wall: standard('#7f7a71', 0.85),
    wood: standard('#6e4c2c', 0.8),
    pallet: standard('#a88760', 0.9),
    carton: standard('#ffffff', 0.92, 0, { map: cartonBoxes() }),
    cab: new MeshPhysicalMaterial({ color: BRAND.negro, roughness: 0.3, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 }),
    lima: standard(BRAND.lima, 0.4, 0.1),
    glass: new MeshPhysicalMaterial({ color: '#070a10', roughness: 0.04, metalness: 0.2, clearcoat: 1 }),
    plate: standard('#ffffff', 0.45, 0, { map: trailerPlate() }),
    stripes: standard('#ffffff', 0.5, 0, { map: warningStripes() }),
    tail: emissive('#3a0604', LIGHTS.brake, 1.1),
    amber: emissive('#3a2104', '#ff9a1f', 1.6),
    reverse: emissive('#2a2a2a', '#ffffff', 0.05),
    markerRed: emissive('#3a0604', '#ff2414', 1.4),
    headlight: emissive('#dddddd', '#fff4e0', 2.5),
    led: emissive('#3a3020', LIGHTS.interior, 0),
  };
}
type Materials = ReturnType<typeof materials>;

/** Plane facing +z by default; rotated to face anywhere. */
const plane = (width: number, height: number) => new PlaneGeometry(width, height);

function trailerBody(m: Materials) {
  const kit = new Kit();
  const length = BODY.rear - BODY.front, middle = (BODY.rear + BODY.front) / 2, wallY = TRUCK.floor + TRUCK.boxHeight / 2;
  // Painted sides, outside and inside.
  kit.add(m.side, plane(length, TRUCK.boxHeight), [HALF + 0.002, wallY, middle], [0, Math.PI / 2, 0]);
  kit.add(m.side, plane(length, TRUCK.boxHeight), [-HALF - 0.002, wallY, middle], [0, -Math.PI / 2, 0]);
  kit.add(m.wall, plane(length, TRUCK.boxHeight), [HALF - 0.04, wallY, middle], [0, -Math.PI / 2, 0]);
  kit.add(m.wall, plane(length, TRUCK.boxHeight), [-HALF + 0.04, wallY, middle], [0, Math.PI / 2, 0]);
  kit.add(m.wall, plane(TRUCK.width - 0.08, length), [0, ROOF - 0.04, middle], [Math.PI / 2, 0, 0]);
  kit.add(m.wall, plane(TRUCK.width - 0.08, TRUCK.boxHeight), [0, wallY, BODY.front + 0.06]);
  kit.add(m.wood, plane(TRUCK.width - 0.08, length), [0, TRUCK.floor + 0.004, middle], [-Math.PI / 2, 0, 0]);
  kit.add(m.white, plane(TRUCK.width, TRUCK.length), [0, ROOF + 0.005, -TRUCK.length / 2], [-Math.PI / 2, 0, 0]);
  kit.add(m.white, plane(TRUCK.width, TRUCK.boxHeight), [0, wallY, BODY.front], [0, Math.PI, 0]);
  kit.box(m.steel, [TRUCK.width - 0.06, 0.07, TRUCK.length - 0.2], [0, TRUCK.floor - 0.035, -TRUCK.length / 2]);

  // Aluminium rails and corner posts.
  for (const s of [-1, 1]) {
    kit.box(m.aluminium, [0.07, 0.1, TRUCK.length], [s * (HALF - 0.02), ROOF - 0.03, -TRUCK.length / 2]);
    kit.box(m.aluminium, [0.08, 0.2, TRUCK.length], [s * (HALF - 0.01), TRUCK.floor - 0.02, -TRUCK.length / 2]);
    kit.box(m.aluminium, [0.08, TRUCK.boxHeight + 0.1, 0.08], [s * (HALF - 0.025), wallY, BODY.front + 0.04]);
    for (let z = -1.6; z > BODY.front + 1; z -= 3) kit.box(m.amber, [0.02, 0.05, 0.1], [s * (HALF + 0.03), TRUCK.floor - 0.02, z]);
    // Chassis, landing legs, side guards, mudguards, mudflaps.
    kit.box(m.steel, [0.12, 0.32, 13], [s * 0.5, TRUCK.floor - 0.22, -7]);
    kit.box(m.steel, [0.13, 0.82, 0.13], [s * 0.9, 0.62, -11]);
    kit.box(m.steel, [0.26, 0.04, 0.26], [s * 0.9, 0.2, -11]);
    for (const y of [0.45, 0.78]) kit.box(m.aluminium, [0.03, 0.1, 5.4], [s * 1.2, y, -7.85]);
    for (const z of [-5.4, -7.85, -10.3]) kit.box(m.steel, [0.05, 0.5, 0.05], [s * 1.18, 0.75, z]);
    kit.box(m.plastic, [0.52, 0.03, 4.15], [s * 1, 1.13, -3.21]);
    kit.box(m.plastic, [0.52, 0.22, 0.03], [s * 1, 1.03, -1.12]);
    kit.box(m.rubber, [0.5, 0.72, 0.012], [s * 1, 0.6, -1.1]);
  }
  for (const z of TRAILER_AXLES) kit.cylinder(m.steel, 0.07, 2.02, [0, TRUCK.wheelRadius, z], [0, 0, Math.PI / 2], 12);

  // Rear frame: posts, header with markers, sill with rubber bumpers.
  for (const s of [-1, 1]) {
    kit.box(m.aluminium, [0.09, TRUCK.boxHeight + 0.06, 0.12], [s * 1.23, wallY, -0.06]);
    kit.box(m.rubber, [0.2, 0.14, 0.1], [s * 0.9, TRUCK.floor - 0.12, 0.0]);
    kit.box(m.markerRed, [0.1, 0.045, 0.02], [s * 1.05, ROOF + 0.005, 0.005]);
  }
  kit.box(m.aluminium, [TRUCK.width, 0.15, 0.12], [0, ROOF - 0.04, -0.06]);
  kit.box(m.steel, [TRUCK.width, 0.17, 0.14], [0, TRUCK.floor - 0.03, -0.07]);
  for (const x of [-0.14, 0, 0.14]) kit.box(m.markerRed, [0.08, 0.04, 0.02], [x, ROOF + 0.005, 0.005]);

  // Light bar, plate and under-run bar.
  kit.box(m.steel, [2.3, 0.06, 0.06], [0, 0.99, -0.14]);
  for (const s of [-1, 1]) {
    kit.box(m.plastic, [0.52, 0.16, 0.07], [s * 0.92, 0.98, -0.08]);
    kit.box(m.amber, [0.15, 0.11, 0.012], [s * 1.08, 0.98, -0.04]);
    kit.box(m.tail, [0.17, 0.11, 0.012], [s * 0.915, 0.98, -0.04]);
    kit.box(m.reverse, [0.13, 0.11, 0.012], [s * 0.75, 0.98, -0.04]);
    kit.box(m.steel, [0.08, 0.42, 0.08], [s * 0.75, 0.74, -0.26]);
  }
  kit.add(m.plate, plane(0.52, 0.114), [0, 0.8, -0.035]);
  kit.box(m.steel, [2.36, 0.12, 0.1], [0, 0.5, -0.21]);
  kit.add(m.stripes, plane(2.3, 0.1), [0, 0.5, -0.159]);

  // Load: pallets of boxes, a gap behind the doors for the cube.
  const rows = [-2.35, -3.25, -4.15, -5.05, -5.95];
  rows.forEach((z, row) => {
    for (const x of [-0.61, 0.61]) {
      const height = 1.28 + ((row * 3 + (x > 0 ? 1 : 0) * 5) % 4) * 0.12;
      kit.box(m.pallet, [1.18, 0.144, 0.78], [x, TRUCK.floor + 0.072, z]);
      kit.box(m.carton, [1.16, height, 0.76], [x, TRUCK.floor + 0.144 + height / 2, z]);
    }
  });
  kit.box(m.led, [0.06, 0.015, 11], [0, ROOF - 0.06, -6.6]);
  return kit.build();
}

function door(m: Materials, side: -1 | 1) {
  // side -1 is the left door (hinge at -x), +1 the right one. Children are in hinge space.
  const kit = new Kit();
  const inward = -side, middle = (DOOR.top + DOOR.bottom) / 2, height = DOOR.top - DOOR.bottom;
  kit.box(m.doorInner, [DOOR.width, height, 0.05], [inward * DOOR.width / 2, middle, -0.026]);
  const face = plane(DOOR.width, height);
  // Each door shows its half of the shared emblem texture.
  const share = DOOR.width / (DOOR_AREA.right - DOOR_AREA.left);
  const uv = face.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    uv.setX(i, side < 0 ? u * share : 1 - (1 - u) * share);
  }
  kit.add(m.door, face, [inward * DOOR.width / 2, middle, 0.0006]);
  for (const offset of [0.5, 0.22]) {
    const x = inward * offset;
    kit.cylinder(m.chrome, 0.017, height - 0.06, [x, middle, 0.045], undefined, 12);
    for (const y of [DOOR.bottom + 0.25, middle, DOOR.top - 0.25]) kit.box(m.chrome, [0.07, 0.045, 0.05], [x, y, 0.025]);
    kit.box(m.chrome, [0.075, 0.075, 0.06], [x, DOOR.bottom + 0.02, 0.03]);
    kit.box(m.chrome, [0.075, 0.075, 0.06], [x, DOOR.top - 0.02, 0.03]);
    kit.box(m.chrome, [0.035, 0.3, 0.03], [x + inward * 0.055, middle - 0.55, 0.06], [0, 0, inward * 0.08]);
  }
  for (const y of [1.55, 2.25, 2.95, 3.62]) {
    kit.box(m.chrome, [0.16, 0.07, 0.035], [inward * 0.06, y, 0.02]);
    kit.cylinder(m.chrome, 0.018, 0.09, [0, y, 0.03], undefined, 10);
  }
  kit.box(m.rubber, [0.014, height, 0.055], [inward * (DOOR.width - 0.007), middle, -0.02]);
  const pivot = new Group();
  pivot.position.set(side * DOOR.hinge, 0, 0);
  pivot.add(kit.build());
  return pivot;
}

function tractor(m: Materials) {
  const chassis = new Kit(), cab = new Kit();
  for (const s of [-1, 1]) {
    chassis.box(m.steel, [0.1, 0.3, 6.2], [s * 0.45, 0.88, -14.5]);
    chassis.box(m.plastic, [0.78, 0.03, 1.35], [s * 0.92, 1.12, -12.35]);
    chassis.box(m.plastic, [0.4, 0.03, 0.9], [s * 1.02, 1.12, -16.05]);
    chassis.box(m.cab, [0.04, 0.55, 2.4], [s * 1.2, 0.86, -14.2]);
    chassis.box(m.lima, [0.012, 0.05, 2.4], [s * 1.222, 1.05, -14.2]);
    chassis.box(m.cab, [0.03, 2.3, 0.55], [s * 1.22, 2.75, -15.2]);
  }
  chassis.cylinder(m.aluminium, 0.3, 1.05, [1.0, 0.72, -14.1], [Math.PI / 2, 0, 0], 20);
  chassis.box(m.steel, [0.95, 0.12, 0.95], [0, 1.1, -12.4]);
  chassis.cylinder(m.steel, 0.07, 1.9, [0, 0.52, -12.35], [0, 0, Math.PI / 2], 12);
  chassis.cylinder(m.steel, 0.07, 1.9, [0, 0.52, -16.05], [0, 0, Math.PI / 2], 12);

  // The cab pitches on its own suspension, around its rear lower edge.
  const pivotAt: Vec3 = [0, 1.2, -15.45];
  const local = (p: Vec3): Vec3 => [p[0] - pivotAt[0], p[1] - pivotAt[1], p[2] - pivotAt[2]];
  cab.add(m.cab, new RoundedBoxGeometry(2.48, 2.72, 2.3, 3, 0.11), local([0, 2.6, -16.6]));
  cab.box(m.glass, [2.26, 1.05, 0.03], local([0, 2.97, -17.755]), [-0.08, 0, 0]);
  for (const s of [-1, 1]) {
    cab.box(m.glass, [0.02, 0.78, 0.95], local([s * 1.243, 2.95, -17.1]));
    cab.box(m.lima, [0.012, 0.07, 2.0], local([s * 1.245, 1.78, -16.55]));
    cab.cylinder(m.chrome, 0.02, 0.42, local([s * 1.44, 2.98, -17.42]), [0, 0, Math.PI / 2], 8);
    cab.box(m.cab, [0.09, 0.52, 0.25], local([s * 1.66, 2.8, -17.36]));
    cab.box(m.chrome, [0.07, 0.46, 0.006], local([s * 1.66, 2.8, -17.232]));
    cab.box(m.headlight, [0.34, 0.13, 0.02], local([s * 0.88, 1.56, -17.765]));
    cab.box(m.plastic, [0.42, 0.06, 0.32], local([s * 0.95, 1.05, -17.0]));
  }
  cab.box(m.steel, [2.0, 0.75, 0.03], local([0, 1.98, -17.76]));
  for (const y of [1.78, 1.98, 2.18]) cab.box(m.chrome, [1.9, 0.03, 0.02], local([0, y, -17.78]));
  cab.box(m.plastic, [2.46, 0.36, 0.14], local([0, 1.1, -17.7]));
  cab.box(m.cab, [2.3, 0.06, 0.26], local([0, 3.6, -17.84]));
  for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) cab.box(m.amber, [0.1, 0.03, 0.04], local([x, 3.975, -17.6]));
  const cabGroup = cab.build();
  const cabPivot = new Group();
  cabPivot.position.set(...pivotAt);
  cabPivot.add(cabGroup);
  const group = new Group();
  group.add(chassis.build(), cabPivot);
  return { group, cabPivot };
}

/** Wheels: tyre, rim and dark rim holes as three instanced meshes. */
const WHEELS: { x: number; z: number; radius: number; width: number }[] = [
  ...TRAILER_AXLES.flatMap(z => [-1, 1].map(s => ({ x: s * 1.0, z, radius: TRUCK.wheelRadius, width: 0.39 }))),
  ...[-1, 1].map(s => ({ x: s * 0.9, z: -12.35, radius: 0.52, width: 0.62 })),
  ...[-1, 1].map(s => ({ x: s * 1.02, z: -16.05, radius: 0.52, width: 0.32 })),
];

function wheels(m: Materials) {
  const tyre = new CylinderGeometry(1, 1, 1, 40).rotateZ(Math.PI / 2);
  const rimParts: BufferGeometry[] = [
    new CylinderGeometry(0.34, 0.34, 0.03, 32).rotateZ(Math.PI / 2).translate(0.005, 0, 0),
    new CylinderGeometry(0.13, 0.15, 0.08, 20).rotateZ(Math.PI / 2).translate(0.04, 0, 0),
    ...Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return new CylinderGeometry(0.019, 0.019, 0.05, 6).rotateZ(Math.PI / 2).translate(0.045, Math.cos(a) * 0.17, Math.sin(a) * 0.17);
    }),
  ];
  const holeParts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    return new CylinderGeometry(0.04, 0.04, 0.034, 12).rotateZ(Math.PI / 2).translate(0.008, Math.cos(a) * 0.255, Math.sin(a) * 0.255);
  });
  const strip = (parts: BufferGeometry[]) => mergeGeometries(parts.map(part => { const g = part.toNonIndexed(); g.deleteAttribute('uv'); return g; }), false)!;
  const meshes = {
    tyre: new InstancedMesh(tyre, m.rubber, WHEELS.length),
    rim: new InstancedMesh(strip(rimParts), m.aluminium, WHEELS.length),
    holes: new InstancedMesh(strip(holeParts), m.plastic, WHEELS.length),
  };
  for (const mesh of Object.values(meshes)) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; }
  const group = new Group();
  group.add(meshes.tyre, meshes.rim, meshes.holes);

  const matrix = new Matrix4(), rotation = new Quaternion(), euler = new Euler(), position = new Vector3(), scale = new Vector3();
  const update = (travelled: number) => {
    WHEELS.forEach((wheel, i) => {
      const angle = -travelled / wheel.radius;
      position.set(wheel.x, wheel.radius, wheel.z);
      meshes.tyre.setMatrixAt(i, matrix.compose(position, rotation.setFromEuler(euler.set(angle, 0, 0)), scale.set(wheel.width, wheel.radius, wheel.radius)));
      // Rims face outwards: the left ones are turned half a circle.
      const outward = Math.sign(wheel.x);
      position.set(wheel.x + outward * (wheel.width / 2 - 0.004), wheel.radius, wheel.z);
      rotation.setFromEuler(euler.set(angle, outward > 0 ? 0 : Math.PI, 0));
      matrix.compose(position, rotation, scale.set(1, wheel.radius / 0.54, wheel.radius / 0.54));
      meshes.rim.setMatrixAt(i, matrix);
      meshes.holes.setMatrixAt(i, matrix);
    });
    for (const mesh of Object.values(meshes)) mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { group, update };
}

function buildTruck(detail: Detail) {
  const m = materials(detail);
  const root = new Group();
  // The trailer pitches around its axles; wheels stay on the road.
  const trailerPivot = new Group();
  trailerPivot.position.set(0, TRUCK.wheelRadius, -3.21);
  const body = trailerBody(m);
  body.position.set(0, -TRUCK.wheelRadius, 3.21);
  const doors = { left: door(m, -1), right: door(m, 1) };
  for (const d of [doors.left, doors.right]) d.position.add(new Vector3(0, -TRUCK.wheelRadius, 3.21));
  trailerPivot.add(body, doors.left, doors.right);

  // Light from inside the trailer once the doors open, and the brake glow on the road.
  const interior = new PointLight(LIGHTS.interior, 0, 9, 2);
  interior.position.set(0, 3.3 - TRUCK.wheelRadius, -1.3 + 3.21);
  const spill = new SpotLight(LIGHTS.interior, 0, 22, 0.66, 0.9, 1.5);
  spill.position.set(0, 3.2 - TRUCK.wheelRadius, -0.8 + 3.21);
  spill.target.position.set(0, -TRUCK.wheelRadius, 7 + 3.21);
  trailerPivot.add(interior, spill, spill.target);

  const brakeGlow = new PointLight(LIGHTS.brake, 0, 7, 2);
  brakeGlow.position.set(0, 0.9, 0.6);

  const cab = tractor(m);
  const wheelSet = wheels(m);
  root.add(trailerPivot, cab.group, wheelSet.group, brakeGlow);

  const doorAngle = (TRUCK.doorAngle * Math.PI) / 180;
  const update = (rig: Rig, time: number) => {
    const moving = rig.speed / TRUCK.cruiseSpeed;
    const pulledAway = rig.leave * 16;
    root.position.z = -pulledAway;
    wheelSet.update(rig.distance + pulledAway);
    // Road rumble while driving, a faint engine idle when stopped.
    const rumble = moving * (0.009 * Math.sin(time * 8.3) + 0.005 * Math.sin(time * 13.9 + 1.2)) + 0.0012 * Math.sin(time * 41);
    trailerPivot.position.y = TRUCK.wheelRadius + rumble;
    trailerPivot.rotation.z = moving * 0.0025 * Math.sin(time * 3.1);
    trailerPivot.rotation.x = -rig.pitch * 0.007;
    cab.cabPivot.rotation.x = -rig.pitch * 0.035 + rumble * 0.4;
    cab.cabPivot.position.y = 1.2 + rumble * 1.4;
    doors.left.rotation.y = -doorAngle * rig.doors;
    doors.right.rotation.y = doorAngle * rig.doors;
    m.glow.draw(rig.strokes);
    m.door.emissiveIntensity = rig.glow * 1.5 + rig.flash * 7;
    m.tail.emissiveIntensity = 1.1 + rig.brake * 7;
    brakeGlow.intensity = rig.brake * 5;
    m.led.emissiveIntensity = rig.interior * 1.7;
    interior.intensity = rig.interior * 7;
    spill.intensity = rig.interior * 40;
  };

  const dispose = () => {
    const textures = new Set<Texture>();
    root.traverse(object => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of ([] as Material[]).concat(mesh.material)) {
        for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
        material.dispose();
      }
    });
    textures.forEach(texture => texture.dispose());
  };
  return { root, update, dispose };
}

export default function Truck({ rig, detail }: { rig: Rig; detail: Detail }) {
  const truck = useMemo(() => buildTruck(detail), [detail]);
  useEffect(() => truck.dispose, [truck]);
  useFrame(state => truck.update(rig, state.clock.elapsedTime));
  return <primitive object={truck.root as Object3D} />;
}
