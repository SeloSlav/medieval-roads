import * as THREE from 'three';
import { Terrain } from './Terrain.ts';

export class TerrainProjector {
  private readonly terrain: Terrain;
  private readonly camera: THREE.Camera;
  private readonly domElement: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();
  private readonly hitScratch = new THREE.Vector3();

  constructor(terrain: Terrain, camera: THREE.Camera, domElement: HTMLElement) {
    this.terrain = terrain;
    this.camera = camera;
    this.domElement = domElement;
  }

  pick(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain.mesh, false);
    if (!hits[0]) return null;
    return this.hitScratch.copy(hits[0].point);
  }

  project(point: THREE.Vector3, offset = 0): THREE.Vector3 {
    return new THREE.Vector3(point.x, this.terrain.getHeightAt(point.x, point.z) + offset, point.z);
  }
}

