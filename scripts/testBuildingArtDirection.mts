import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { getBuildingMaterialLibraryStats } from '../src/buildings/buildingMaterials.ts';
import { BUILDING_KINDS } from '../src/generated/gameBalance.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import { BUILD_MENU_ENTRIES, renderBuildMenuCards } from '../src/ui/buildMenuCards.ts';
import { disposeObject3D } from '../src/utils/dispose.ts';

const html = renderBuildMenuCards();
const urls = [...html.matchAll(/<img class="construction-card__art" src="([^"]+)"/g)].map((match) => match[1]);

if (urls.length !== BUILD_MENU_ENTRIES.length) {
  throw new Error(`Expected ${BUILD_MENU_ENTRIES.length} build-card images, found ${urls.length}.`);
}

const uniqueUrls = new Set(urls);
if (uniqueUrls.size !== urls.length) {
  throw new Error('Every construction-menu entry must reference its own named art asset.');
}

const hashes = new Map<string, string>();
for (const url of urls) {
  const file = resolve('public', url.replace(/^\//, '').replace(/^assets\//, 'assets/'));
  const bytes = readFileSync(file);
  if (bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${url} is not a PNG.`);

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 1024 || height !== 1536) {
    throw new Error(`${url} must be a 1024x1536 portrait card; found ${width}x${height}.`);
  }

  const hash = createHash('sha256').update(bytes).digest('hex');
  const duplicate = hashes.get(hash);
  if (duplicate) throw new Error(`${url} duplicates ${duplicate}; every building needs bespoke card art.`);
  hashes.set(hash, url);
}

const modelNames = new Set<string>();
const sharedMaterials = new Set<THREE.Material>();
let texturedMeshCount = 0;
let largestMetricUvSpan = 0;
for (const kind of BUILDING_KINDS) {
  const model = createBuildingMesh(kind);
  if (!model.name) throw new Error(`${kind} must have a named, dedicated model.`);
  if (modelNames.has(model.name)) throw new Error(`${kind} reuses the model identity “${model.name}”.`);
  modelNames.add(model.name);

  let meshCount = 0;
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.userData.sharedBuildingMaterial !== true) {
        throw new Error(`${kind} contains a per-instance building material (${material.name || material.type}).`);
      }
      sharedMaterials.add(material);
      if (typeof material.userData.metricUvMeters !== 'number') continue;
      const uv = object.geometry.getAttribute('uv');
      if (!uv || uv.count === 0) throw new Error(`${kind} has a textured mesh without UVs.`);
      texturedMeshCount += 1;
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let index = 0; index < uv.count; index++) {
        minU = Math.min(minU, uv.getX(index));
        maxU = Math.max(maxU, uv.getX(index));
        minV = Math.min(minV, uv.getY(index));
        maxV = Math.max(maxV, uv.getY(index));
      }
      largestMetricUvSpan = Math.max(largestMetricUvSpan, maxU - minU, maxV - minV);
    }
  });
  if (meshCount < 4) throw new Error(`${kind} is missing a sufficiently legible procedural model (${meshCount} meshes).`);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.x <= 0 || size.y <= 0 || size.z <= 0) {
    throw new Error(`${kind} produced invalid model bounds.`);
  }
}

const stats = getBuildingMaterialLibraryStats();
if (stats.constructionMaterials > 20) {
  throw new Error(`Shared construction palette grew beyond 20 materials (${stats.constructionMaterials}).`);
}
if (stats.detailMaterials > 9) {
  throw new Error(`Shared building-detail palette grew beyond 9 materials (${stats.detailMaterials}).`);
}
if (sharedMaterials.size > 29) {
  throw new Error(`All buildings should use at most 29 shared materials; found ${sharedMaterials.size}.`);
}
if (texturedMeshCount === 0 || largestMetricUvSpan <= 1.5) {
  throw new Error('Building meshes are not receiving repeatable metric UV coordinates.');
}

for (const kind of BUILDING_KINDS) {
  const duplicate = createBuildingMesh(kind);
  duplicate.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!sharedMaterials.has(material)) {
        throw new Error(`${kind} allocated a different material on its second construction.`);
      }
    }
  });
  disposeObject3D(duplicate);
}

let residenceCount = 0;
for (const tier of [1, 2, 3] as const) {
  for (let seed = 0; seed < 18; seed++) {
    const residence = createResidenceMesh(seed, tier);
    const windowMaterial = residence.userData.windowMaterial as THREE.Material | undefined;
    if (!windowMaterial || windowMaterial.userData.sharedBuildingMaterial !== false) {
      throw new Error(`Residence ${seed}/${tier} is missing its independently animated window material.`);
    }
    residence.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material === windowMaterial) continue;
        if (material.userData.sharedBuildingMaterial !== true) {
          throw new Error(`Residence ${seed}/${tier} contains an unshared construction material.`);
        }
        sharedMaterials.add(material);
      }
    });
    residenceCount += 1;
    disposeObject3D(residence);
    windowMaterial.dispose();
  }
}

const finalStats = getBuildingMaterialLibraryStats();
if (finalStats.constructionMaterials < 15 || finalStats.constructionMaterials > 20 || finalStats.detailMaterials !== 9) {
  throw new Error(`Expected a 15–20 construction + 9 detail shared palette; found ${finalStats.constructionMaterials} + ${finalStats.detailMaterials}.`);
}
if (sharedMaterials.size > 29) {
  throw new Error(`Buildings and residences exceeded the 29 shared material ceiling (${sharedMaterials.size}).`);
}

console.log(`building art-direction tests passed (${urls.length} cards, ${BUILDING_KINDS.length} models, ${residenceCount} residence variants, ${sharedMaterials.size} shared materials, ${texturedMeshCount} metric-UV meshes)`);
