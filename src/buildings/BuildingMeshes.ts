import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import {
  addMesh,
  metalMaterial,
  quarryRockMaterial,
  shingleMaterial,
  stoneMaterial,
  tileMaterial,
  timberMaterial,
} from './buildingMaterials.ts';

function addLogPile(
  group: THREE.Group,
  baseX: number,
  baseZ: number,
  floorY: number,
  pileRows: number,
  logLength: number,
  logRadius: number,
): void {
  const logSpacing = logRadius * 1.72;
  const rowSpacing = logRadius * 1.82;

  for (let row = 0; row < pileRows; row++) {
    const logsInRow = pileRows - row;
    const rowY = floorY + logRadius + row * rowSpacing;
    const rowSpan = (logsInRow - 1) * logSpacing;
    for (let col = 0; col < logsInRow; col++) {
      addMesh(
        group,
        new THREE.CylinderGeometry(logRadius * 0.93, logRadius * 1.05, logLength, 8),
        (row + col) % 2 === 0 ? timberMaterial('weathered') : timberMaterial('mid'),
        new THREE.Vector3(baseX, rowY, baseZ - rowSpan * 0.5 + col * logSpacing),
        new THREE.Euler(0, 0, Math.PI * 0.5),
      );
    }
  }
}

/** Two large logs on the bottom, one centered on top — oriented along the building length. */
function addLargeLogPyramid(
  group: THREE.Group,
  centerX: number,
  baseZ: number,
  floorY: number,
  logLength: number,
  logRadius: number,
): void {
  const logSpacing = logRadius * 1.74;
  const rowSpacing = logRadius * 1.88;
  const bottomY = floorY + logRadius;

  for (const [col, zOffset] of [[0, -0.5], [1, 0.5]] as const) {
    addMesh(
      group,
      new THREE.CylinderGeometry(logRadius * 0.94, logRadius * 1.08, logLength, 10),
      col === 0 ? timberMaterial('weathered') : timberMaterial('mid'),
      new THREE.Vector3(centerX, bottomY, baseZ + zOffset * logSpacing),
      new THREE.Euler(0, 0, Math.PI * 0.5),
    );
  }

  addMesh(
    group,
    new THREE.CylinderGeometry(logRadius * 0.92, logRadius * 1.06, logLength, 10),
    timberMaterial('light'),
    new THREE.Vector3(centerX, bottomY + rowSpacing, baseZ),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );
}

function addStoneBlockPile(
  group: THREE.Group,
  baseX: number,
  baseZ: number,
  floorY: number,
  pileRows: number,
  blockLength: number,
  blockWidth: number,
  blockHeight: number,
): void {
  const rowSpacing = blockHeight * 1.06;
  const colSpacing = blockLength * 1.1;

  for (let row = 0; row < pileRows; row++) {
    const blocksInRow = pileRows - row;
    const rowY = floorY + blockHeight * 0.5 + row * rowSpacing;
    const rowSpan = (blocksInRow - 1) * colSpacing;
    for (let col = 0; col < blocksInRow; col++) {
      const shade = (row + col) % 3 === 0 ? 'light' : (row + col) % 2 === 0 ? 'mid' : 'dark';
      const heightJitter = blockHeight * (0.94 + ((row + col) % 4) * 0.03);
      const widthJitter = blockWidth * (0.96 + ((col + 1) % 3) * 0.04);
      addMesh(
        group,
        new THREE.BoxGeometry(widthJitter, heightJitter, blockLength * 0.97),
        quarryRockMaterial(shade),
        new THREE.Vector3(
          baseX + ((col % 2) - 0.5) * 0.05,
          rowY,
          baseZ - rowSpan * 0.5 + col * colSpacing,
        ),
        new THREE.Euler(0, ((row + col) % 5) * 0.018 - 0.036, 0),
      );
    }
  }
}

/** Two wide blocks on the bottom, one centered on top — mirrors the lumber log pyramid. */
function addStoneBlockPyramid(
  group: THREE.Group,
  centerX: number,
  baseZ: number,
  floorY: number,
  blockLength: number,
  blockWidth: number,
  blockHeight: number,
): void {
  const spacing = blockLength * 1.12;
  const rowSpacing = blockHeight * 1.08;
  const bottomY = floorY + blockHeight * 0.5;

  for (const [col, zOffset] of [[0, -0.5], [1, 0.5]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(blockWidth, blockHeight, blockLength),
      quarryRockMaterial(col === 0 ? 'mid' : 'dark'),
      new THREE.Vector3(centerX, bottomY, baseZ + zOffset * spacing),
    );
  }

  addMesh(
    group,
    new THREE.BoxGeometry(blockWidth * 0.96, blockHeight * 0.94, blockLength * 0.95),
    quarryRockMaterial('light'),
    new THREE.Vector3(centerX, bottomY + rowSpacing, baseZ),
  );
}

function addCircularSaw(group: THREE.Group, x: number, z: number, floorY: number): void {
  const saw = new THREE.Group();
  saw.position.set(x, floorY, z);
  saw.rotation.y = Math.PI * 0.5;

  const bladeRadius = 1.35;
  const tableY = 0.25;

  // Heavy timber bed and cast-iron table top.
  addMesh(
    saw,
    new THREE.BoxGeometry(3.8, 0.24, 1.9),
    timberMaterial('dark'),
    new THREE.Vector3(0, 0.12, 0),
  );
  addMesh(
    saw,
    new THREE.BoxGeometry(3.55, 0.07, 1.72),
    metalMaterial('iron'),
    new THREE.Vector3(0, tableY, 0),
  );

  // Vertical blade — local +X becomes world +Z after the 90° yaw.
  addMesh(
    saw,
    new THREE.CylinderGeometry(bladeRadius, bladeRadius, 0.05, 28),
    metalMaterial('steel'),
    new THREE.Vector3(0.18, tableY + bladeRadius * 0.82, 0),
    new THREE.Euler(0, 0, Math.PI * 0.5),
  );

  // Timber guard frame over the upper blade arc.
  const guardX = 0.18;
  const guardBaseY = tableY + bladeRadius * 0.15;
  const guardTopY = tableY + bladeRadius * 1.75;
  for (const zSign of [-1, 1] as const) {
    addMesh(
      saw,
      new THREE.BoxGeometry(0.14, guardTopY - guardBaseY, 0.14),
      timberMaterial('dark'),
      new THREE.Vector3(guardX, (guardBaseY + guardTopY) * 0.5, zSign * bladeRadius * 0.62),
    );
  }
  addMesh(
    saw,
    new THREE.BoxGeometry(0.14, 0.14, bladeRadius * 1.32),
    timberMaterial('dark'),
    new THREE.Vector3(guardX, guardTopY, 0),
  );

  // Drive pulley and crank wheel beside the table.
  addMesh(
    saw,
    new THREE.CylinderGeometry(0.62, 0.62, 0.14, 18),
    metalMaterial('iron'),
    new THREE.Vector3(-1.25, 0.62, -0.75),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );
  addMesh(
    saw,
    new THREE.BoxGeometry(0.12, 0.85, 0.12),
    timberMaterial('mid'),
    new THREE.Vector3(-1.25, 0.62, -0.75),
  );
  addMesh(
    saw,
    new THREE.BoxGeometry(0.55, 0.1, 0.1),
    timberMaterial('light'),
    new THREE.Vector3(-1.25, 1.02, -0.75),
  );

  group.add(saw);
}

type GableAxis = 'x' | 'z';

/** Solid triangular infill closing the gable void between the wall plate and ridge. */
function addTriangularGableWall(
  group: THREE.Group,
  axis: GableAxis,
  planePos: number,
  halfSpan: number,
  wallTop: number,
  ridgeHeight: number,
  thickness: number,
  material: THREE.Material,
  outwardSign: -1 | 0 | 1 = 0,
  centerX = 0,
  centerZ = 0,
): void {
  const span = halfSpan - (outwardSign === 0 ? 0.06 : 0.14);
  const shape = new THREE.Shape();
  shape.moveTo(-span, 0);
  shape.lineTo(span, 0);
  shape.lineTo(0, ridgeHeight);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(0, wallTop, 0);

  if (axis === 'x') {
    geometry.rotateY(Math.PI * 0.5);
    geometry.translate(centerX + planePos + outwardSign * thickness * 0.5, 0, centerZ);
  } else {
    geometry.translate(centerX, 0, centerZ + planePos + outwardSign * thickness * 0.5);
  }

  addMesh(group, geometry, material, new THREE.Vector3(0, 0, 0));
}

/** Long timber sawmill — stone plinth, plank walls, red terracotta gabled roof. */
export function createLumberMillMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lumber mill';

  const length = 18;
  const width = 7;
  const stoneHeight = 1.2;
  const wallHeight = 3.6;
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const totalWall = stoneHeight + wallHeight;

  // Limestone plinth — Gorski Kotar white stone base.
  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.35, stoneHeight, width + 0.35),
    stoneMaterial('light'),
    new THREE.Vector3(0, stoneHeight * 0.5, 0),
  );

  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.08, 0.18, width + 0.08),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, stoneHeight + 0.09, 0),
  );

  // Corner quoins.
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.55, totalWall, 0.55),
      stoneMaterial('mid'),
      new THREE.Vector3(sx * (halfL - 0.18), totalWall * 0.5, sz * (halfW - 0.18)),
    );
  }

  // Timber post frame along long walls.
  const postSpacing = 2.4;
  for (let x = -halfL + 1.2; x <= halfL - 0.5; x += postSpacing) {
    for (const z of [-halfW + 0.22, halfW - 0.22]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.22, wallHeight, 0.22),
        timberMaterial('dark'),
        new THREE.Vector3(x, stoneHeight + wallHeight * 0.5, z),
      );
    }
  }

  // Horizontal plank cladding between posts.
  const plankHeight = 0.42;
  const plankCount = Math.floor(wallHeight / plankHeight);
  for (let row = 0; row < plankCount; row++) {
    const y = stoneHeight + plankHeight * 0.5 + row * plankHeight;
    const shade = row % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered');
    addMesh(group, new THREE.BoxGeometry(length - 0.5, plankHeight * 0.88, 0.16), shade, new THREE.Vector3(0, y, halfW - 0.08));
    addMesh(group, new THREE.BoxGeometry(length - 0.5, plankHeight * 0.88, 0.16), shade, new THREE.Vector3(0, y, -halfW + 0.08));
  }

  // Gable end walls (timber over stone).
  addMesh(
    group,
    new THREE.BoxGeometry(0.2, wallHeight, width - 0.4),
    timberMaterial('light'),
    new THREE.Vector3(halfL - 0.1, stoneHeight + wallHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.2, wallHeight, width - 0.4),
    timberMaterial('light'),
    new THREE.Vector3(-halfL + 0.1, stoneHeight + wallHeight * 0.5, 0),
  );

  // Open bay / log intake on front gable.
  addMesh(
    group,
    new THREE.BoxGeometry(0.12, 2.45, 3.4),
    timberMaterial('dark'),
    new THREE.Vector3(halfL + 0.02, stoneHeight + 1.35, 0),
  );

  const roofY = stoneHeight + wallHeight;
  const floorY = stoneHeight;

  // Main-floor circular saw — visible through the open intake bay.
  addCircularSaw(group, halfL - 4.8, 0.35, floorY);

  // Interior log piles awaiting the blade.
  addLogPile(group, -halfL + 3.8, -1.6, floorY, 4, 2.4, 0.22);
  addLogPile(group, -1.2, 1.85, floorY, 3, 2.0, 0.2);
  addLogPile(group, halfL - 8.2, -0.4, floorY, 4, 2.2, 0.21);

  // Loft deck — horizontal ceiling where the wall frame meets the roof attic.
  addMesh(
    group,
    new THREE.BoxGeometry(length - 0.55, 0.14, width - 0.45),
    timberMaterial('light'),
    new THREE.Vector3(0, roofY - 0.06, 0),
  );

  // Loft joists visible from the main floor below.
  for (let x = -halfL + 2.2; x <= halfL - 2.2; x += 2.8) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.16, 0.2, width - 0.52),
      timberMaterial('dark'),
      new THREE.Vector3(x, roofY - 0.2, 0),
    );
  }

  // Red terracotta tile roof — ridge along the long axis, triangular gable ends.
  const ridgeHeight = 2.6;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLength = halfW / Math.cos(roofPitch) + 0.3;

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(length + 0.65, 0.12, slopeLength),
      tileMaterial(0),
      new THREE.Vector3(0, roofY + ridgeHeight * 0.5, side * halfW * 0.46),
      new THREE.Euler(side > 0 ? roofPitch : -roofPitch, 0, 0),
    );
  }

  addMesh(
    group,
    new THREE.BoxGeometry(length + 0.8, 0.22, 0.36),
    tileMaterial(2),
    new THREE.Vector3(0, roofY + ridgeHeight + 0.06, 0),
  );

  // Triangular gable walls — seal the end faces below the roof.
  const gableWallThickness = 0.18;
  for (const xSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'x',
      xSign * (halfL - 0.08),
      halfW,
      roofY,
      ridgeHeight,
      gableWallThickness,
      timberMaterial('light'),
    );
  }

  // Stone chimney — common in the region.
  addMesh(
    group,
    new THREE.BoxGeometry(0.9, 2.8, 0.9),
    stoneMaterial('mid'),
    new THREE.Vector3(-halfL + 1.5, totalWall + 1.35, halfW - 1.2),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(1.0, 0.18, 1.0),
    stoneMaterial('mid'),
    new THREE.Vector3(-halfL + 1.5, totalWall + 2.75, halfW - 1.2),
  );

  // Triangular log pile beside the mill — stacked rows tapering to a point.
  addLogPile(group, halfL - 1.8, halfW + 1.6, 0, 5, 3.0, 0.26);

  // Large-log pyramids along the opposite long wall — 2 bottom, 1 top per stack.
  const sideLogRadius = 0.44;
  const sideLogLength = 4.4;
  const sidePileZ = -halfW - 1.55;
  const pyramidSpacing = 3.6;
  for (let x = -halfL + 2.8; x <= halfL - 3.2; x += pyramidSpacing) {
    addLargeLogPyramid(group, x, sidePileZ, 0, sideLogLength, sideLogRadius);
  }

  return group;
}

/** A-frame forester hut — stone plinth, timber walls, shingled roof. */
export function createReforesterHutMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Reforester hut';

  const width = 6.4;
  const depth = 5.8;
  const stoneHeight = 1.0;
  const wallHeight = 2.15;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const wallTop = stoneHeight + wallHeight;
  const ridgeHeight = 3.35;
  const roofPitch = Math.atan2(ridgeHeight, halfW);
  const slopeLen = halfW / Math.cos(roofPitch) + 0.25;
  const wallInset = 0.1;
  const plankHeight = 0.38;
  const plankRows = Math.floor(wallHeight / plankHeight);

  // Limestone plinth — continuous base tying the shell together.
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.38, stoneHeight, depth + 0.38),
    stoneMaterial('light'),
    new THREE.Vector3(0, stoneHeight * 0.5, 0),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(width + 0.1, 0.16, depth + 0.1),
    stoneMaterial('mortar'),
    new THREE.Vector3(0, stoneHeight + 0.08, 0),
  );

  // Corner quoins and posts — frame every wall corner.
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.42, wallHeight + 0.14, 0.42),
      stoneMaterial('mid'),
      new THREE.Vector3(sx * (halfW - 0.14), stoneHeight + (wallHeight + 0.14) * 0.5, sz * (halfD - 0.14)),
    );
    addMesh(
      group,
      new THREE.BoxGeometry(0.2, wallHeight, 0.2),
      timberMaterial('dark'),
      new THREE.Vector3(sx * (halfW - wallInset), stoneHeight + wallHeight * 0.5, sz * (halfD - wallInset)),
    );
  }

  // Side walls — horizontal plank cladding between corner posts.
  for (let row = 0; row < plankRows; row++) {
    const y = stoneHeight + plankHeight * 0.5 + row * plankHeight;
    const shade = row % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered');
    addMesh(
      group,
      new THREE.BoxGeometry(0.18, plankHeight * 0.88, depth - 0.42),
      shade,
      new THREE.Vector3(-halfW + 0.09, y, 0),
    );
    addMesh(
      group,
      new THREE.BoxGeometry(0.18, plankHeight * 0.88, depth - 0.42),
      shade,
      new THREE.Vector3(halfW - 0.09, y, 0),
    );
  }

  // Back wall planks.
  for (let row = 0; row < plankRows; row++) {
    const y = stoneHeight + plankHeight * 0.5 + row * plankHeight;
    const shade = row % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered');
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.42, plankHeight * 0.88, 0.18),
      shade,
      new THREE.Vector3(0, y, -halfD + 0.09),
    );
  }

  // Front wall with door — plank sections flanking a framed opening.
  const doorWidth = 1.15;
  const doorHeight = 1.95;
  const doorCenterX = 0.12;
  const doorLeft = doorCenterX - doorWidth * 0.5;
  const doorRight = doorCenterX + doorWidth * 0.5;
  const frontZ = halfD - 0.09;
  const leftPanelWidth = doorLeft - (-halfW + 0.21);
  const rightPanelWidth = halfW - 0.21 - doorRight;

  for (let row = 0; row < plankRows; row++) {
    const y = stoneHeight + plankHeight * 0.5 + row * plankHeight;
    const shade = row % 2 === 0 ? timberMaterial('mid') : timberMaterial('weathered');
    const rowTop = y + plankHeight * 0.44;
    const doorTop = stoneHeight + doorHeight;

    if (rowTop <= doorTop) {
      addMesh(
        group,
        new THREE.BoxGeometry(leftPanelWidth, plankHeight * 0.88, 0.18),
        shade,
        new THREE.Vector3(-halfW + 0.21 + leftPanelWidth * 0.5, y, frontZ),
      );
      addMesh(
        group,
        new THREE.BoxGeometry(rightPanelWidth, plankHeight * 0.88, 0.18),
        shade,
        new THREE.Vector3(halfW - 0.21 - rightPanelWidth * 0.5, y, frontZ),
      );
    } else {
      addMesh(
        group,
        new THREE.BoxGeometry(width - 0.42, plankHeight * 0.88, 0.18),
        shade,
        new THREE.Vector3(0, y, frontZ),
      );
    }
  }

  // Door frame and panel — same timber-frame language as the lumber mill.
  addMesh(
    group,
    new THREE.BoxGeometry(0.14, doorHeight + 0.12, 0.22),
    timberMaterial('dark'),
    new THREE.Vector3(doorLeft - 0.04, stoneHeight + doorHeight * 0.5, frontZ + 0.04),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(0.14, doorHeight + 0.12, 0.22),
    timberMaterial('dark'),
    new THREE.Vector3(doorRight + 0.04, stoneHeight + doorHeight * 0.5, frontZ + 0.04),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(doorWidth + 0.32, 0.14, 0.22),
    timberMaterial('dark'),
    new THREE.Vector3(doorCenterX, stoneHeight + doorHeight + 0.04, frontZ + 0.04),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(doorWidth - 0.08, doorHeight - 0.1, 0.1),
    timberMaterial('weathered'),
    new THREE.Vector3(doorCenterX, stoneHeight + doorHeight * 0.5 - 0.02, frontZ + 0.01),
  );

  // Wall plate tying the front and back walls to the side posts.
  for (const zSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.24, 0.16, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(0, wallTop - 0.04, zSign * (halfD - wallInset)),
    );
  }

  // Loft deck — horizontal ceiling where the wall frame meets the roof attic.
  addMesh(
    group,
    new THREE.BoxGeometry(width - 0.55, 0.14, depth - 0.45),
    timberMaterial('light'),
    new THREE.Vector3(0, wallTop - 0.06, 0),
  );

  // Loft joists visible from the main floor below.
  for (let z = -halfD + 2.2; z <= halfD - 2.2; z += 2.8) {
    addMesh(
      group,
      new THREE.BoxGeometry(width - 0.52, 0.2, 0.16),
      timberMaterial('dark'),
      new THREE.Vector3(0, wallTop - 0.2, z),
    );
  }

  // Ridge beam.
  addMesh(
    group,
    new THREE.BoxGeometry(0.18, 0.18, depth - 0.12),
    timberMaterial('dark'),
    new THREE.Vector3(0, wallTop + ridgeHeight, 0),
  );

  // Shingled roof slopes.
  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(slopeLen, 0.11, depth + 0.28),
      shingleMaterial(),
      new THREE.Vector3(side * halfW * 0.46, wallTop + ridgeHeight * 0.48, 0),
      new THREE.Euler(0, 0, side * -roofPitch),
    );
  }

  // Triangular gable walls — seal the front and back faces below the roof.
  const gableWallThickness = 0.18;
  for (const zSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'z',
      zSign * (halfD - 0.08),
      halfW,
      wallTop,
      ridgeHeight,
      gableWallThickness,
      timberMaterial('mid'),
    );
  }

  // Axe block beside the door, resting on the plinth.
  addMesh(
    group,
    new THREE.BoxGeometry(0.55, 0.42, 0.55),
    timberMaterial('dark'),
    new THREE.Vector3(halfW - 0.55, stoneHeight + 0.21, halfD - 0.45),
  );

  return group;
}

/** Timber hut for processing raw logs — reuses the forester shell with a yard log pile. */
export function createWoodcuttersLodgeMesh(): THREE.Group {
  const group = createReforesterHutMesh();
  group.name = "Woodcutter's lodge";

  const halfW = 6.4 * 0.5;
  const halfD = 5.8 * 0.5;
  addLogPile(group, halfW - 0.3, halfD + 1.6, 0, 5, 3.0, 0.26);

  return group;
}

function addQuarryHoistFrame(
  group: THREE.Group,
  hoistX: number,
  hoistZ: number,
): void {
  const frameSpan = 2.6;
  const frameHeight = 5.4;
  const legW = 0.32;
  const crossbarH = 0.24;
  const crossY = frameHeight - crossbarH * 0.5;
  const crossBottomY = crossY - crossbarH * 0.5;
  const pulleyRadius = 0.34;
  const pulleyThickness = 0.18;
  const blockW = 0.85;
  const blockH = 0.5;
  const blockX = hoistX - 0.55;
  const blockTopY = blockH;
  const pulleyX = blockX;

  for (const z of [-frameSpan, frameSpan] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(legW, frameHeight, legW),
      timberMaterial('dark'),
      new THREE.Vector3(hoistX, frameHeight * 0.5, hoistZ + z),
    );
  }

  addMesh(
    group,
    new THREE.BoxGeometry(0.24, crossbarH, frameSpan * 2 + 0.42),
    timberMaterial('weathered'),
    new THREE.Vector3(hoistX, crossY, hoistZ),
  );

  const pulleyY = crossBottomY - pulleyRadius;
  addMesh(
    group,
    new THREE.BoxGeometry(0.12, crossBottomY - pulleyY, 0.16),
    timberMaterial('dark'),
    new THREE.Vector3(pulleyX, (crossBottomY + pulleyY) * 0.5, hoistZ),
  );

  addMesh(
    group,
    new THREE.CylinderGeometry(pulleyRadius, pulleyRadius, pulleyThickness, 12),
    metalMaterial('iron'),
    new THREE.Vector3(pulleyX, pulleyY, hoistZ),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );

  addMesh(
    group,
    new THREE.BoxGeometry(blockW, blockH, 0.7),
    quarryRockMaterial('mid'),
    new THREE.Vector3(blockX, blockH * 0.5, hoistZ),
  );

  const hookY = blockTopY + 0.06;
  addMesh(
    group,
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    metalMaterial('iron'),
    new THREE.Vector3(blockX, hookY, hoistZ),
  );

  const ropeTopY = pulleyY - pulleyRadius;
  const ropeBottomY = hookY + 0.06;
  const ropeHeight = ropeTopY - ropeBottomY;
  addMesh(
    group,
    new THREE.BoxGeometry(0.055, ropeHeight, 0.055),
    timberMaterial('mid'),
    new THREE.Vector3(blockX, ropeBottomY + ropeHeight * 0.5, hoistZ),
  );
}

function addQuarryForemanShed(group: THREE.Group, shedX: number, shedZ: number): void {
  const shedW = 5.0;
  const shedD = 4.0;
  const shedStoneH = 0.38;
  const shedWallH = 2.35;
  const halfW = shedW * 0.5;
  const halfD = shedD * 0.5;
  const wallTop = shedStoneH + shedWallH;
  const ridgeH = 1.25;
  const wallInset = 0.1;
  const roofPitch = Math.atan2(ridgeH, halfD);
  const slopeLen = halfD / Math.cos(roofPitch) + 0.18;
  const plankH = 0.36;
  const frontZ = shedZ + halfD - wallInset;

  addMesh(
    group,
    new THREE.BoxGeometry(shedW + 0.3, shedStoneH, shedD + 0.3),
    quarryRockMaterial('dark'),
    new THREE.Vector3(shedX, shedStoneH * 0.5, shedZ),
  );

  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(0.34, shedWallH, 0.34),
      timberMaterial('dark'),
      new THREE.Vector3(
        shedX + sx * (halfW - 0.14),
        shedStoneH + shedWallH * 0.5,
        shedZ + sz * (halfD - 0.14),
      ),
    );
  }

  const doorWidth = 0.95;
  const doorHeight = 1.85;
  const doorCenterX = shedX - 0.2;
  const doorLeft = doorCenterX - doorWidth * 0.5;
  const doorRight = doorCenterX + doorWidth * 0.5;
  const leftPanelWidth = doorLeft - (shedX - halfW + 0.2);
  const rightPanelWidth = shedX + halfW - 0.2 - doorRight;

  for (let rowY = shedStoneH; rowY < wallTop - 0.02; rowY += plankH) {
    const remaining = wallTop - rowY;
    const rowHeight = Math.min(plankH, remaining);
    const centerY = rowY + rowHeight * 0.5;
    const shade = Math.floor((rowY - shedStoneH) / plankH) % 2 === 0
      ? timberMaterial('weathered')
      : timberMaterial('mid');
    const rowTop = centerY + rowHeight * 0.5;
    const doorTop = shedStoneH + doorHeight;

    addMesh(
      group,
      new THREE.BoxGeometry(0.16, rowHeight * 0.94, shedD - 0.34),
      shade,
      new THREE.Vector3(shedX - halfW + 0.08, centerY, shedZ),
    );
    addMesh(
      group,
      new THREE.BoxGeometry(0.16, rowHeight * 0.94, shedD - 0.34),
      shade,
      new THREE.Vector3(shedX + halfW - 0.08, centerY, shedZ),
    );
    addMesh(
      group,
      new THREE.BoxGeometry(shedW - 0.34, rowHeight * 0.94, 0.16),
      shade,
      new THREE.Vector3(shedX, centerY, shedZ - halfD + 0.08),
    );

    if (rowTop <= doorTop) {
      if (leftPanelWidth > 0.08) {
        addMesh(
          group,
          new THREE.BoxGeometry(leftPanelWidth, rowHeight * 0.94, 0.16),
          shade,
          new THREE.Vector3(shedX - halfW + 0.2 + leftPanelWidth * 0.5, centerY, frontZ),
        );
      }
      if (rightPanelWidth > 0.08) {
        addMesh(
          group,
          new THREE.BoxGeometry(rightPanelWidth, rowHeight * 0.94, 0.16),
          shade,
          new THREE.Vector3(shedX + halfW - 0.2 - rightPanelWidth * 0.5, centerY, frontZ),
        );
      }
    } else {
      addMesh(
        group,
        new THREE.BoxGeometry(shedW - 0.34, rowHeight * 0.94, 0.16),
        shade,
        new THREE.Vector3(shedX, centerY, frontZ),
      );
    }
  }

  for (const zSign of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(shedW - 0.24, 0.14, 0.14),
      timberMaterial('dark'),
      new THREE.Vector3(shedX, wallTop - 0.05, shedZ + zSign * (halfD - wallInset)),
    );
  }

  addMesh(
    group,
    new THREE.BoxGeometry(doorWidth + 0.12, doorHeight + 0.1, 0.12),
    timberMaterial('dark'),
    new THREE.Vector3(doorCenterX, shedStoneH + (doorHeight + 0.1) * 0.5, frontZ + 0.02),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(doorWidth, doorHeight, 0.08),
    timberMaterial('mid'),
    new THREE.Vector3(doorCenterX, shedStoneH + doorHeight * 0.5, frontZ + 0.03),
  );

  for (const side of [-1, 1] as const) {
    addMesh(
      group,
      new THREE.BoxGeometry(shedW + 0.24, 0.1, slopeLen),
      tileMaterial(side > 0 ? 1 : 0),
      new THREE.Vector3(shedX, wallTop + ridgeH * 0.5, shedZ + side * halfD * 0.46),
      new THREE.Euler(side > 0 ? roofPitch : -roofPitch, 0, 0),
    );
  }

  addMesh(
    group,
    new THREE.BoxGeometry(shedW + 0.32, 0.14, 0.24),
    tileMaterial(2),
    new THREE.Vector3(shedX, wallTop + ridgeH + 0.03, shedZ),
  );

  const gableThickness = 0.16;
  for (const xSign of [-1, 1] as const) {
    addTriangularGableWall(
      group,
      'x',
      xSign * (halfW - wallInset),
      halfD,
      wallTop,
      ridgeH,
      gableThickness,
      timberMaterial('weathered'),
      0,
      shedX,
      shedZ,
    );
  }
}

/** Stonecutter's camp — work yard with block stacks, hoist, and foreman's shed. */
export function createStoneQuarryMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Stonecutter's camp";

  const pitX = 0;
  const pitZ = -2.8;
  const pitRadius = 5.4;
  const terraceCount = 3;
  const terraceStep = 0.52;
  const bermTube = 0.38;

  for (let tier = 0; tier < terraceCount; tier++) {
    const scale = 1 - tier * 0.2;
    const terraceH = 0.48;
    const y = tier * terraceStep;
    const inner = pitRadius * scale;
    const shade = tier === 0 ? 'cut' : tier === terraceCount - 1 ? 'dark' : 'mid';
    addMesh(
      group,
      new THREE.CylinderGeometry(inner, inner + 0.82, terraceH, 14, 1, false),
      quarryRockMaterial(shade),
      new THREE.Vector3(pitX, y + terraceH * 0.5, pitZ),
    );
  }

  const pitFloorH = 0.1;
  addMesh(
    group,
    new THREE.CylinderGeometry(pitRadius * 0.38, pitRadius * 0.42, pitFloorH, 12),
    quarryRockMaterial('spoil'),
    new THREE.Vector3(pitX + 0.4, pitFloorH * 0.5, pitZ - 0.3),
  );

  addMesh(
    group,
    new THREE.TorusGeometry(pitRadius + 0.55, bermTube, 6, 20),
    quarryRockMaterial('dust'),
    new THREE.Vector3(pitX, bermTube, pitZ),
    new THREE.Euler(Math.PI * 0.5, 0, 0),
  );

  const spoilA_H = 0.85;
  const spoilB_H = 0.5;
  addMesh(
    group,
    new THREE.BoxGeometry(2.4, spoilA_H, 1.9),
    quarryRockMaterial('spoil'),
    new THREE.Vector3(pitX + 1.4, spoilA_H * 0.5 + 0.02, pitZ + 0.6),
  );
  addMesh(
    group,
    new THREE.BoxGeometry(1.6, spoilB_H, 1.3),
    quarryRockMaterial('dust'),
    new THREE.Vector3(pitX + 2.0, spoilA_H + spoilB_H * 0.5 + 0.02, pitZ + 0.75),
  );

  const stackX = -8.6;
  addStoneBlockPile(group, stackX, 2.0, 0, 5, 1.35, 0.82, 0.58);
  addStoneBlockPyramid(group, stackX, 5.4, 0, 1.55, 0.88, 0.62);
  addStoneBlockPile(group, stackX + 1.5, -0.6, 0, 3, 1.1, 0.72, 0.5);

  for (let i = 0; i < 5; i++) {
    const rubbleW = 0.28 + (i % 3) * 0.12;
    const rubbleH = rubbleW * 0.7;
    addMesh(
      group,
      new THREE.BoxGeometry(rubbleW, rubbleH, rubbleW * 1.1),
      quarryRockMaterial(i % 2 === 0 ? 'dark' : 'mid'),
      new THREE.Vector3(stackX + 1.8 + i * 0.45, rubbleH * 0.5, 0.4 + i * 0.35),
      new THREE.Euler(0, i * 0.4, 0),
    );
  }

  addQuarryHoistFrame(group, 6.2, -6.4);
  addQuarryForemanShed(group, 7.4, 7.2);

  return group;
}

export function createBuildingMesh(kind: BuildingKind): THREE.Group {
  switch (kind) {
    case 'lumber_mill':
      return createLumberMillMesh();
    case 'reforester':
      return createReforesterHutMesh();
    case 'woodcutters_lodge':
      return createWoodcuttersLodgeMesh();
    case 'stone_quarry':
      return createStoneQuarryMesh();
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
