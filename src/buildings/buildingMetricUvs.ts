import * as THREE from 'three';

type ParametricGeometry = THREE.BufferGeometry & {
  parameters?: Record<string, number>;
};

/**
 * Converts normalized primitive UVs to metre-based UVs for textured shared
 * construction materials. Geometry is cloned only if it was already prepared
 * for a different material scale.
 */
export function prepareBuildingGeometryUvs(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.BufferGeometry {
  const metersPerTile = material.userData.metricUvMeters;
  if (typeof metersPerTile !== 'number' || metersPerTile <= 0) return geometry;

  const existing = geometry.userData.metricUvMeters;
  if (existing === metersPerTile) return geometry;
  const target = typeof existing === 'number' ? geometry.clone() : geometry;

  if (isCylindricalGeometry(target)) {
    scaleCylindricalUvs(target, metersPerTile);
  } else if (target.type === 'TorusGeometry') {
    scaleTorusUvs(target, metersPerTile);
  } else if (target.type === 'SphereGeometry') {
    scaleSphereUvs(target, metersPerTile);
  } else {
    applyDominantAxisProjection(target, metersPerTile);
  }
  target.userData.metricUvMeters = metersPerTile;
  return target;
}

function applyDominantAxisProjection(geometry: THREE.BufferGeometry, metersPerTile: number): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || !normal) return;

  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);

    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = (nx < 0 ? -z : z) / metersPerTile;
      v = y / metersPerTile;
    } else if (ay >= ax && ay >= az) {
      u = x / metersPerTile;
      v = (ny < 0 ? z : -z) / metersPerTile;
    } else {
      u = (nz < 0 ? x : -x) / metersPerTile;
      v = y / metersPerTile;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function isCylindricalGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.type === 'CylinderGeometry' || geometry.type === 'ConeGeometry';
}

function scaleCylindricalUvs(geometry: THREE.BufferGeometry, metersPerTile: number): void {
  const uv = geometry.getAttribute('uv');
  const parameters = (geometry as ParametricGeometry).parameters;
  if (!uv || !parameters) return;
  const radius = Math.max(parameters.radiusTop ?? 0, parameters.radiusBottom ?? 0, parameters.radius ?? 0);
  const height = parameters.height ?? radius * 2;
  scaleUvs(uv, Math.max(1, Math.PI * 2 * radius / metersPerTile), Math.max(1, height / metersPerTile));
}

function scaleTorusUvs(geometry: THREE.BufferGeometry, metersPerTile: number): void {
  const uv = geometry.getAttribute('uv');
  const parameters = (geometry as ParametricGeometry).parameters;
  if (!uv || !parameters) return;
  scaleUvs(
    uv,
    Math.max(1, Math.PI * 2 * (parameters.radius ?? 1) / metersPerTile),
    Math.max(1, Math.PI * 2 * (parameters.tube ?? 0.4) / metersPerTile),
  );
}

function scaleSphereUvs(geometry: THREE.BufferGeometry, metersPerTile: number): void {
  const uv = geometry.getAttribute('uv');
  const parameters = (geometry as ParametricGeometry).parameters;
  if (!uv || !parameters) return;
  const radius = parameters.radius ?? 1;
  scaleUvs(uv, Math.max(1, Math.PI * 2 * radius / metersPerTile), Math.max(1, Math.PI * radius / metersPerTile));
}

function scaleUvs(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, repeatU: number, repeatV: number): void {
  for (let i = 0; i < attribute.count; i++) {
    attribute.setXY(i, attribute.getX(i) * repeatU, attribute.getY(i) * repeatV);
  }
  attribute.needsUpdate = true;
}
