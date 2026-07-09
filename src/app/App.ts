import { CameraController } from '../camera/CameraController.ts';
import { InputManager } from '../input/InputManager.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSelection } from '../roads/RoadSelection.ts';
import { RoadTool } from '../roads/RoadTool.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import { BuildToolbar, type ToolbarStats } from '../ui/BuildToolbar.ts';

const TARGET_MAX_FPS = 90;
const TARGET_FRAME_MS = 1000 / TARGET_MAX_FPS;

export class App {
  private readonly root: HTMLElement;
  private sceneManager: SceneManager | null = null;
  private cameraController: CameraController | null = null;
  private input: InputManager | null = null;
  private roadNetwork: RoadNetwork | null = null;
  private roadTool: RoadTool | null = null;
  private roadSelection: RoadSelection | null = null;
  private toolbar: BuildToolbar | null = null;
  private animationId = 0;
  private lastTime = 0;
  private frameBudgetTime = 0;
  private fpsSampleStart = 0;
  private fpsFrameCount = 0;
  private fpsAccumulatedSeconds = 0;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    this.root.innerHTML = `
      <div class="app-shell">
        <div class="scene-root" data-scene-root></div>
        <div data-ui-root></div>
      </div>
    `;

    const sceneRoot = this.mustElement('[data-scene-root]');
    const uiRoot = this.mustElement('[data-ui-root]');

    const sceneManager = await SceneManager.create(sceneRoot);
    const input = new InputManager(sceneManager.renderer.domElement);
    const roadNetwork = new RoadNetwork();
    const cameraController = new CameraController({
      camera: sceneManager.camera,
      target: sceneManager.cameraTarget,
      domElement: sceneManager.renderer.domElement,
      bounds: sceneManager.terrain.bounds,
      getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
      getCursorOverride: () => this.roadTool?.getCursor() ?? null,
    });

    const roadSelection = new RoadSelection({
      camera: sceneManager.camera,
      domElement: sceneManager.renderer.domElement,
      network: roadNetwork,
      sceneManager,
      onChange: () => this.syncToolbar(),
    });

    const roadTool = new RoadTool({
      camera: sceneManager.camera,
      domElement: sceneManager.renderer.domElement,
      input,
      network: roadNetwork,
      sceneManager,
      selection: roadSelection,
      terrainProjector: sceneManager.terrainProjector,
      onNetworkChanged: () => {
        sceneManager.syncRoadNetwork(roadNetwork);
        roadSelection.refresh();
        this.syncToolbar();
      },
      onModeChanged: () => this.syncToolbar(),
    });

    const toolbar = new BuildToolbar(uiRoot, {
      onToggleRoad: () => roadTool.setEnabled(!roadTool.isEnabled()),
      onUndo: () => roadTool.undo(),
      onDelete: () => roadTool.deleteSelected(),
    });

    this.sceneManager = sceneManager;
    this.input = input;
    this.roadNetwork = roadNetwork;
    this.cameraController = cameraController;
    this.roadTool = roadTool;
    this.roadSelection = roadSelection;
    this.toolbar = toolbar;

    sceneManager.syncRoadNetwork(roadNetwork);
    this.syncToolbar();
    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.lastTime = performance.now();
    this.frameBudgetTime = this.lastTime;
    this.fpsSampleStart = this.lastTime;
    this.animationId = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    this.roadTool?.dispose();
    this.roadSelection?.dispose();
    this.cameraController?.dispose();
    this.input?.dispose();
    this.sceneManager?.dispose();
  }

  private readonly tick = (time: number): void => {
    if (this.disposed) return;
    const budgetElapsed = time - this.frameBudgetTime;
    if (budgetElapsed < TARGET_FRAME_MS) {
      this.animationId = requestAnimationFrame(this.tick);
      return;
    }
    this.frameBudgetTime = time - (budgetElapsed % TARGET_FRAME_MS);
    const rawDt = (time - this.lastTime) / 1000;
    if (rawDt > 0.25) this.resetFpsSample(time);
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.lastTime = time;
    this.cameraController?.update(dt);
    this.roadTool?.update(dt);
    this.sceneManager?.render(dt);
    this.updateFps(time, dt);
    this.animationId = requestAnimationFrame(this.tick);
  };

  private readonly onResize = (): void => {
    this.sceneManager?.resize();
  };

  private syncToolbar(): void {
    if (!this.toolbar || !this.roadNetwork || !this.roadTool || !this.roadSelection) return;
    const stats: ToolbarStats = {
      nodes: this.roadNetwork.nodes.size,
      edges: this.roadNetwork.edges.size,
      selected: this.roadSelection.getSelectedEdgeId() !== null,
      mode: this.roadTool.isEnabled() ? 'road' : 'idle',
    };
    this.toolbar.setStats(stats);
  }

  private updateFps(time: number, dt: number): void {
    this.fpsFrameCount++;
    this.fpsAccumulatedSeconds += dt;
    const sampleMs = time - this.fpsSampleStart;
    if (sampleMs < 400) return;
    const fps = this.fpsFrameCount / Math.max(this.fpsAccumulatedSeconds, 0.001);
    this.toolbar?.setFps(fps);
    (window as typeof window & { __medievalRoadStats?: { backend?: string; fps: number; calls?: number; triangles?: number; pixelRatio?: number } })
      .__medievalRoadStats = { fps, ...this.sceneManager?.getPerformanceStats() };
    this.resetFpsSample(time);
  }

  private resetFpsSample(time: number): void {
    this.fpsSampleStart = time;
    this.fpsFrameCount = 0;
    this.fpsAccumulatedSeconds = 0;
  }

  private mustElement(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing app element ${selector}`);
    return element;
  }
}

