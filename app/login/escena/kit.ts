import { BoxGeometry, BufferGeometry, CylinderGeometry, Euler, Group, Matrix4, Mesh, Quaternion, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec3 } from './config';

const matrix = new Matrix4(), quaternion = new Quaternion(), euler = new Euler();

/**
 * Collects static parts per material and merges them into one mesh each, so a
 * truck made of hundreds of pieces costs a handful of draw calls.
 */
export class Kit {
  private parts = new Map<Material, BufferGeometry[]>();

  add(material: Material, geometry: BufferGeometry, position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) {
    const piece = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    for (const name of Object.keys(piece.attributes)) if (!['position', 'normal', 'uv'].includes(name)) piece.deleteAttribute(name);
    piece.clearGroups();
    matrix.compose(new Vector3(...position), quaternion.setFromEuler(euler.set(...rotation)), new Vector3(...scale));
    piece.applyMatrix4(matrix);
    const list = this.parts.get(material) ?? [];
    list.push(piece);
    this.parts.set(material, list);
    return this;
  }

  box(material: Material, size: Vec3, position: Vec3, rotation?: Vec3) {
    return this.add(material, new BoxGeometry(...size), position, rotation);
  }

  /** Cylinder along Y unless rotated; `radius` may be [top, bottom]. */
  cylinder(material: Material, radius: number | [number, number], height: number, position: Vec3, rotation?: Vec3, segments = 20) {
    const [top, bottom] = typeof radius === 'number' ? [radius, radius] : radius;
    return this.add(material, new CylinderGeometry(top, bottom, height, segments), position, rotation);
  }

  build(shadows = true) {
    const group = new Group();
    for (const [material, pieces] of this.parts) {
      const mesh = new Mesh(mergeGeometries(pieces, false)!, material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      group.add(mesh);
      pieces.forEach(piece => piece.dispose());
    }
    this.parts.clear();
    return group;
  }
}
