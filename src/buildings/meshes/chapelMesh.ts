import * as THREE from 'three';
import {
  addMesh,
  metalMaterial,
  residenceFacadeMaterial,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';
import { addTriangularGableWall } from '../meshPrimitives.ts';

type ChapelMaterials = {
  limewash: THREE.MeshStandardMaterial;
  limewashShade: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  redPaint: THREE.MeshStandardMaterial;
  bluePaint: THREE.MeshStandardMaterial;
  ochrePaint: THREE.MeshStandardMaterial;
};

function createChapelMaterials(): ChapelMaterials {
  return {
    limewash: residenceFacadeMaterial('white'),
    limewashShade: sharedBuildingMaterial('masonryLight'),
    glass: sharedBuildingMaterial('glass'),
    brass: sharedBuildingDetailMaterial('brass'),
    redPaint: sharedBuildingDetailMaterial('paintRed'),
    bluePaint: sharedBuildingDetailMaterial('paintBlue'),
    ochrePaint: sharedBuildingDetailMaterial('paintOchre'),
  };
}

function createLancetGeometry(width: number, height: number, depth: number): THREE.ExtrudeGeometry {
  const springY = height * 0.58;
  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.5, 0);
  shape.lineTo(width * 0.5, 0);
  shape.lineTo(width * 0.5, springY);
  shape.quadraticCurveTo(width * 0.45, height * 0.82, 0, height);
  shape.quadraticCurveTo(-width * 0.45, height * 0.82, -width * 0.5, springY);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
}

function addLancetWindow(
  group: THREE.Group,
  materials: ChapelMaterials,
  face: 'left' | 'right',
  z: number,
  sillY: number,
  halfWidth: number,
): void {
  const outward = face === 'left' ? -1 : 1;
  const window = new THREE.Group();
  window.position.set(outward * (halfWidth - 0.035), sillY, z);
  window.rotation.y = outward > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
  group.add(window);

  addMesh(
    window,
    createLancetGeometry(0.96, 1.9, 0.11),
    stoneMaterial('light'),
    new THREE.Vector3(0, 0, 0),
  );
  addMesh(
    window,
    createLancetGeometry(0.66, 1.55, 0.12),
    materials.glass,
    new THREE.Vector3(0, 0.12, 0.075),
  );

  addMesh(
    window,
    new THREE.BoxGeometry(0.045, 1.38, 0.055),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.78, 0.145),
  );
  addMesh(
    window,
    new THREE.BoxGeometry(0.56, 0.045, 0.055),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.72, 0.15),
  );
}

function addSideButtress(
  group: THREE.Group,
  side: -1 | 1,
  z: number,
  wallTop: number,
  halfWidth: number,
): void {
  const x = side * (halfWidth + 0.16);
  addMesh(
    group,
    new THREE.BoxGeometry(0.72, 0.46, 0.92),
    stoneMaterial('mid'),
    new THREE.Vector3(x, 0.23, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.56, wallTop * 0.68, 0.68),
    stoneMaterial('light'),
    new THREE.Vector3(x - side * 0.05, 0.46 + wallTop * 0.34, z),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.63, 0.15, 0.75),
    stoneMaterial('mortar'),
    new THREE.Vector3(x - side * 0.05, 0.46 + wallTop * 0.68, z),
  );
}

function addFoundationStones(group: THREE.Group, width: number, depth: number): void {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const blockHeight = 0.38;

  for (let i = 0; i < 8; i++) {
    const x = -halfW + 0.42 + i * ((width - 0.84) / 7);
    const blockWidth = i % 3 === 0 ? 0.78 : 0.68;
    for (const z of [-halfD - 0.09, halfD + 0.09]) {
      addMesh(
        group,
        new THREE.BoxGeometry(blockWidth, blockHeight + (i % 2) * 0.05, 0.38),
        stoneMaterial(i % 2 === 0 ? 'light' : 'mid'),
        new THREE.Vector3(x, blockHeight * 0.5, z),
        new THREE.Euler(0, (i % 2 === 0 ? 1 : -1) * 0.025, 0),
      );
    }
  }

  for (let i = 0; i < 9; i++) {
    const z = -halfD + 0.4 + i * ((depth - 0.8) / 8);
    for (const x of [-halfW - 0.09, halfW + 0.09]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.38, blockHeight + ((i + 1) % 2) * 0.05, 0.65),
        stoneMaterial(i % 2 === 0 ? 'mid' : 'light'),
        new THREE.Vector3(x, blockHeight * 0.5, z),
        new THREE.Euler(0, (i % 2 === 0 ? 1 : -1) * 0.035, 0),
      );
    }
  }
}

function addPlankDoor(
  group: THREE.Group,
  materials: ChapelMaterials,
  frontZ: number,
  floorY: number,
): void {
  const doorWidth = 1.38;
  const doorHeight = 2.22;

  addMesh(
    group,
    createLancetGeometry(doorWidth + 0.48, doorHeight + 0.56, 0.16),
    stoneMaterial('light'),
    new THREE.Vector3(0, floorY - 0.02, frontZ - 0.08),
  );
  addMesh(
    group,
    createLancetGeometry(doorWidth, doorHeight, 0.18),
    timberMaterial('dark'),
    new THREE.Vector3(0, floorY, frontZ + 0.025),
  );

  const plankWidth = doorWidth / 5;
  for (let i = 0; i < 5; i++) {
    addMesh(
      group,
      new THREE.BoxGeometry(plankWidth * 0.84, doorHeight * 0.68, 0.055),
      i % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered'),
      new THREE.Vector3(-doorWidth * 0.5 + plankWidth * (i + 0.5), floorY + doorHeight * 0.34, frontZ + 0.225),
    );
  }

  for (const y of [floorY + 0.48, floorY + 1.42]) {
    addMesh(
      group,
      new THREE.BoxGeometry(doorWidth * 0.82, 0.09, 0.065),
      metalMaterial('iron'),
      new THREE.Vector3(0, y, frontZ + 0.27),
    );
  }
  addMesh(
    group,
    new THREE.TorusGeometry(0.1, 0.025, 6, 12),
    materials.brass,
    new THREE.Vector3(0.38, floorY + 1.02, frontZ + 0.31),
  );
}

function addFolkFrieze(
  group: THREE.Group,
  materials: ChapelMaterials,
  frontZ: number,
  y: number,
): void {
  const colors = [materials.redPaint, materials.bluePaint, materials.ochrePaint] as const;
  for (let i = 0; i < 9; i++) {
    const x = -1.84 + i * 0.46;
    const diamond = addMesh(
      group,
      new THREE.BoxGeometry(0.25, 0.25, 0.055),
      colors[i % colors.length],
      new THREE.Vector3(x, y, frontZ + 0.075),
      new THREE.Euler(0, 0, Math.PI * 0.25),
    );
    diamond.scale.set(1, 1, 1);
  }
}

function addRoofBands(
  group: THREE.Group,
  halfWidth: number,
  depth: number,
  wallTop: number,
  ridgeHeight: number,
  roofPitch: number,
  roofMaterial: THREE.Material,
): void {
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < 6; row++) {
      const t = (row + 0.25) / 6.5;
      const x = side * halfWidth * (1 - t);
      const y = wallTop + ridgeHeight * t;
      addMesh(
        group,
        new THREE.BoxGeometry(0.075, 0.065, depth + 0.5),
        roofMaterial,
        new THREE.Vector3(x, y + 0.025, 0),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }
}

function addBellTower(
  group: THREE.Group,
  materials: ChapelMaterials,
  towerZ: number,
  roofY: number,
  roofMaterial: THREE.Material,
): void {
  const baseSize = 1.62;
  const belfryFloorY = roofY + 0.18;
  const belfryHeight = 2.08;
  const bellLift = 0.18;

  addMesh(
    group,
    new THREE.BoxGeometry(baseSize + 0.16, 0.2, baseSize + 0.16),
    stoneMaterial('light'),
    new THREE.Vector3(0, belfryFloorY, towerZ),
  );
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.2, belfryHeight, 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(sx * 0.62, belfryFloorY + belfryHeight * 0.5, towerZ + sz * 0.62),
    );
  }
  for (const zSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(baseSize, 0.18, 0.18),
      timberMaterial('weathered'),
      new THREE.Vector3(0, belfryFloorY + belfryHeight, towerZ + zSign * 0.62),
    );
  }
  for (const xSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.18, 0.18, baseSize),
      timberMaterial('weathered'),
      new THREE.Vector3(xSign * 0.62, belfryFloorY + belfryHeight, towerZ),
    );
  }

  addMesh(
    group,
    new THREE.CylinderGeometry(0.24, 0.43, 0.72, 12),
    materials.brass,
    new THREE.Vector3(0, belfryFloorY + 0.84 + bellLift, towerZ),
  );
  addMesh(
    group,
    new THREE.TorusGeometry(0.4, 0.055, 7, 16),
    materials.brass,
    new THREE.Vector3(0, belfryFloorY + 0.48 + bellLift, towerZ),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.055, 0.055, 1.34, 8),
    timberMaterial('dark'),
    new THREE.Vector3(0, belfryFloorY + 1.28 + bellLift, towerZ),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
  addMesh(
    group,
    new THREE.SphereGeometry(0.09, 8, 6),
    materials.brass,
    new THREE.Vector3(0, belfryFloorY + 0.38 + bellLift, towerZ),
  );

  const towerRoofY = belfryFloorY + belfryHeight + 0.63;
  addMesh(
    group,
    new THREE.ConeGeometry(1.32, 1.48, 4),
    roofMaterial,
    new THREE.Vector3(0, towerRoofY, towerZ),
    new THREE.Euler(0, Math.PI * 0.25, 0),
  );
  addMesh(
    group,
    new THREE.CylinderGeometry(0.055, 0.055, 0.78, 8),
    metalMaterial('iron'),
    new THREE.Vector3(0, towerRoofY + 0.98, towerZ),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.48, 0.065, 0.065),
    metalMaterial('iron'),
    new THREE.Vector3(0, towerRoofY + 1.12, towerZ),
  );
}

/**
 * Gorski village chapel: compact limewashed nave, hand-laid limestone base,
 * deep tile roof and an open oak belfry. This is the visual benchmark for the
 * settlement's grounded, crafted architectural language.
 */
export function createChapelMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Chapel';
  const materials = createChapelMaterials();
  const roofMaterial = sharedBuildingMaterial('slate');

  const width = 5.2;
  const depth = 6.9;
  const foundationHeight = 0.48;
  const wallHeight = 3.15;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallTop = foundationHeight + wallHeight;
  const ridgeHeight = 2.55;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.28;
  const frontZ = halfD - 0.075;

  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.5, foundationHeight, depth + 0.5),
    stoneMaterial('mid'),
    new THREE.Vector3(0, foundationHeight * 0.5, 0),
  );
  addFoundationStones(group, width, depth);
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.18, 0.14, depth + 0.18),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, foundationHeight + 0.07, 0),
  );

  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.18, wallHeight, depth - 0.18),
    materials.limewash,
    new THREE.Vector3(0, foundationHeight + wallHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.08, 0.24, depth + 0.08),
    materials.limewashShade,
    new THREE.Vector3(0, wallTop - 0.12, 0),
  );

  for (const z of [-1.65, 1.15]) {
    addLancetWindow(group, materials, 'left', z, 1.28, halfW);
    addLancetWindow(group, materials, 'right', z, 1.28, halfW);
    addSideButtress(group, -1, z - 0.72, wallTop, halfW);
    addSideButtress(group, 1, z - 0.72, wallTop, halfW);
  }

  addPlankDoor(group, materials, frontZ, foundationHeight + 0.08);
  addFolkFrieze(group, materials, frontZ, wallTop - 0.46);

  for (let step = 0; step < 3; step++) {
    addMesh(
      group,
      new THREE.BoxGeometry(2.45 - step * 0.32, 0.16, 0.62),
      stoneMaterial(step === 1 ? 'mid' : 'light'),
      new THREE.Vector3(0, 0.08 + step * 0.12, halfD + 0.52 - step * 0.18),
    );
  }

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.15, depth + 0.48),
      roofMaterial,
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
  }
  addRoofBands(group, halfW, depth, wallTop, ridgeHeight, roofPitch, roofMaterial);
  addMesh(
    group,
    new THREE.BoxGeometry(0.28, 0.2, depth + 0.66),
    roofMaterial,
    new THREE.Vector3(0, wallTop + ridgeHeight + 0.04, 0),
  );

  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfD - 0.065),
      halfW,
      wallTop,
      ridgeHeight,
      0.16,
      materials.limewash,
    );

    for (const side of [-1, 1] as const) {
      addMesh(
        group,
        new THREE.BoxGeometry(slopeLen, 0.15, 0.16),
        timberMaterial('dark'),
        new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, zSign * (halfD + 0.17)),
        new THREE.Euler(0, 0, side * -roofPitch),
      );
    }
  }

  addBellTower(group, materials, 1.18, wallTop + ridgeHeight * 0.7, roofMaterial);

  const frontGableZ = halfD + 0.12;
  addMesh(
    group,
    new THREE.CircleGeometry(0.48, 16),
    materials.glass,
    new THREE.Vector3(0, wallTop + 1.05, frontGableZ),
  );
  addMesh(
    group,
    new THREE.TorusGeometry(0.54, 0.1, 8, 18),
    stoneMaterial('light'),
    new THREE.Vector3(0, wallTop + 1.05, frontGableZ + 0.02),
  );
  for (let i = 0; i < 4; i++) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.055, 0.88, 0.045),
      timberMaterial('dark'),
      new THREE.Vector3(0, wallTop + 1.05, frontGableZ + 0.07),
      new THREE.Euler(0, 0, i * Math.PI * 0.25),
    );
  }

  // A low parish wall frames the entrance without obscuring the facade.
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.82, 0.44 + (i % 2) * 0.06, 0.46),
        stoneMaterial(i % 2 === 0 ? 'light' : 'mid'),
        new THREE.Vector3(side * (1.78 + i * 0.72), 0.22, halfD + 0.82 + i * 0.12),
        new THREE.Euler(0, side * (0.08 + i * 0.035), 0),
      );
    }
  }

  return group;
}
