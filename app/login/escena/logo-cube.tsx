'use client';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, MeshStandardMaterial, type Group } from 'three';
import { cubePosition, type Rig } from './intro-timeline';
import { cubeFaces } from './textures';

const EDGE = 0.72;
/** Resting pose: front and the Intraser side towards the camera, a little of the top, like the loader. */
const REST = { yaw: -0.5, pitch: 0.36 };

/** The CuboLoader cube, built for real: one company per side, the emblem on top and bottom. */
export default function LogoCube({ rig }: { rig: Rig }) {
  const group = useRef<Group>(null);
  const materials = useMemo(() => cubeFaces(512).map(map => new MeshStandardMaterial({
    map, roughness: 0.55, emissiveMap: map, emissive: new Color('#ffffff'), emissiveIntensity: 0.14,
  })), []);
  useEffect(() => () => materials.forEach(material => { material.map?.dispose(); material.dispose(); }), [materials]);
  const position = useMemo<[number, number, number]>(() => [0, 0, 0], []);

  useFrame(state => {
    const cube = group.current;
    if (!cube) return;
    cube.visible = rig.cube > 0.002;
    if (!cube.visible) return;
    const t = state.clock.elapsedTime;
    cubePosition(rig, position);
    cube.position.set(position[0], position[1] + rig.calm * 0.05 * Math.sin(t * 1.25), position[2]);
    cube.scale.setScalar(0.6 + 0.4 * Math.min(1, rig.cube * 1.5));
    // Spins through the four companies on its way out, then sways gently.
    cube.rotation.y = REST.yaw - (1 - rig.spin) * Math.PI * 2.5 + rig.calm * 0.12 * Math.sin(t * 0.55);
    cube.rotation.x = REST.pitch * rig.spin + 0.3 * Math.sin(rig.spin * Math.PI) + rig.calm * 0.03 * Math.sin(t * 0.8 + 1);
  });

  return <group ref={group} visible={false}>
    <mesh material={materials} castShadow>
      <boxGeometry args={[EDGE, EDGE, EDGE]} />
    </mesh>
  </group>;
}
