import { CameraController } from '../camera/CameraController.ts';
import { FirstPersonController } from '../camera/FirstPersonController.ts';
import { InputManager } from '../input/InputManager.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadNetwork } from '../roads/RoadNetwork.ts';
import { RoadSelection } from '../roads/RoadSelection.ts';
import { RoadTool } from '../roads/RoadTool.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import { beginStartupTextureLoad } from '../scene/startupTextures.ts';
import { BuildToolbar, type ToolbarStats } from '../ui/BuildToolbar.ts';
import { LoadingScreen } from '../ui/LoadingScreen.ts';
import { ToastManager } from '../ui/ToastManager.ts';
import { roadPlacementReasonToToastId } from '../ui/toastMessages.ts';

const TARGET_MAX_FPS = 90;
const TARGET_FRAME_MS = 1000 / TARGET_MAX_FPS;

export class App {
  private readonly root: HTMLElement;
  private sceneManager: SceneManager | null = null;
  private cameraController: CameraController | null = null;
  private firstPersonController: FirstPersonController | null = null;
  private input: InputManager | null = null;
  private roadNetwork: RoadNetwork | null = null;
  private roadTool: RoadTool | null = null;
  private roadSelection: RoadSelection | null = null;
  private toolbar: BuildToolbar | null = null;
  private toastManager: ToastManager | null = null;
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
    const loadingScreen = LoadingScreen.tryCreate();
    const materialsPromise = RoadMaterialFactory.create(8);
    const startupTexturesPromise = beginStartupTextureLoad();
    loadingScreen?.setProgress({ label: 'Starting world…', detail: 'Setting up scene shell' });

    this.root.innerHTML = `
      <div class="app-shell">
        <div class="scene-root" data-scene-root></div>
        <div data-ui-root></div>
      </div>
    `;

    const sceneRoot = this.mustElement('[data-scene-root]');
    const uiRoot = this.mustElement('[data-ui-root]');

    const sceneManager = await SceneManager.create(sceneRoot, (label, detail) => {
      loadingScreen?.setProgress({ label, detail });
    }, materialsPromise, startupTexturesPromise);
    const input = new InputManager(sceneManager.renderer.domElement);
    const roadNetwork = new RoadNetwork();
    const cameraController = new CameraController({
      camera: sceneManager.camera,
      target: sceneManager.cameraTarget,
      domElement: sceneManager.renderer.domElement,
      bounds: sceneManager.terrain.bounds,
      getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
      getCursorOverride: () => this.firstPersonController?.isActive() ? 'default' : this.roadTool?.getCursor() ?? null,
      shouldIgnoreInput: (event) => this.roadTool?.shouldBlockCameraInput(event) ?? false,
    });

    const roadSelection = new RoadSelection({
      camera: sceneManager.camera,
      domElement: sceneManager.renderer.domElement,
      network: roadNetwork,
      sceneManager,
      onChange: () => this.syncToolbar(),
    });

    const roadTool = new RoadTool({
      domElement: sceneManager.renderer.domElement,
      network: roadNetwork,
      sceneManager,
      selection: roadSelection,
      terrainProjector: sceneManager.terrainProjector,
      onNetworkChanged: () => {
        sceneManager.syncRoadNetwork(roadNetwork);
        roadSelection.refresh();
        this.syncToolbar();
      },
      onStateChanged: () => this.syncToolbar(),
      onDeleteRequested: (request) => {
        if (!this.toolbar) return;
        if (!request) {
          this.toolbar.hideDeletePopup();
          return;
        }
        this.toolbar.showDeletePopup({
          clientX: request.clientX,
          clientY: request.clientY,
          onRemove: () => roadTool.confirmDelete(request.edgeId),
          onCancel: () => roadSelection.setSelected(null),
        });
      },
      onPlacementRejected: (event) => {
        const messageId = roadPlacementReasonToToastId(event.reason);
        if (messageId) this.toastManager?.showMessageId(messageId, { variant: 'error' });
      },
    });

    let firstPersonController: FirstPersonController;

    const toolbar = new BuildToolbar(uiRoot, {
      onOpenRoads: () => roadTool.setEnabled(!roadTool.isEnabled()),
      onBuildRoad: () => roadTool.commitDraft(),
      onMenuOpenChange: (open) => {
        cameraController.setInputEnabled(!open && !firstPersonController.isActive());
      },
      canOpenMenuFromKeyboard: () => !firstPersonController.isActive(),
    });
    const toastManager = new ToastManager(uiRoot);

    firstPersonController = new FirstPersonController({
      camera: sceneManager.camera,
      domElement: sceneManager.renderer.domElement,
      bounds: sceneManager.terrain.bounds,
      getHeightAt: (x, z) => sceneManager.terrain.getHeightAt(x, z),
      getRoadDeckY: (x, z) => sceneManager.sampleRoadDeckY(x, z),
      getOrbitSpawn: () => {
        const target = cameraController.getTargetPosition();
        return { x: target.x, z: target.z, yaw: cameraController.getYaw() };
      },
      isMenuOpen: () => toolbar.isGameMenuOpen(),
      onModeChange: (active) => {
        cameraController.setInputEnabled(!active && !toolbar.isGameMenuOpen());
        toolbar.setFirstPersonMode(active);
        if (active) {
          if (roadTool.isEnabled()) roadTool.setEnabled(false);
          return;
        }
        const pos = firstPersonController.getPosition();
        cameraController.syncFromFirstPerson(pos.x, pos.z, firstPersonController.getBodyYaw());
      },
    });

    this.sceneManager = sceneManager;
    this.input = input;
    this.roadNetwork = roadNetwork;
    this.cameraController = cameraController;
    this.firstPersonController = firstPersonController;
    this.roadTool = roadTool;
    this.roadSelection = roadSelection;
    this.toolbar = toolbar;
    this.toastManager = toastManager;

    sceneManager.syncRoadNetwork(roadNetwork);
    this.syncToolbar();
    window.addEventListener('resize', this.onResize);
    this.onResize();
    cameraController.applyRtsOrbitView();
    cameraController.update(0);
    this.toolbar?.setZoomPercent(cameraController.getZoomPercent());
    this.lastTime = performance.now();
    this.frameBudgetTime = this.lastTime;
    this.fpsSampleStart = this.lastTime;
    loadingScreen?.setProgress({ label: 'Almost ready…', detail: 'Rendering first frame' });
    sceneManager.render(0, cameraController.getOrbitDistance());
    loadingScreen?.dismiss();
    this.animationId = requestAnimationFrame(this.tick);
    window.setTimeout(() => {
      void (async () => {
        try {
          await sceneManager.finishVegetation();
          if (this.roadNetwork) sceneManager.syncRoadNetwork(this.roadNetwork);
        } catch (error) {
          console.error('Vegetation build failed:', error);
        }
      })();
    }, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    this.roadTool?.dispose();
    this.roadSelection?.dispose();
    this.toastManager?.dispose();
    this.firstPersonController?.dispose();
    this.cameraController?.dispose();
    this.toolbar?.dispose();
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
    const firstPersonActive = this.firstPersonController?.isActive() ?? false;
    if (firstPersonActive) {
      this.firstPersonController?.update(dt);
      this.toolbar?.setFirstPersonMode(true);
      this.roadTool?.update(dt);
      this.updateBuildButtonPosition();
      this.sceneManager?.render(dt, 12, true);
    } else {
      this.cameraController?.update(dt);
      this.toolbar?.setFirstPersonMode(false);
      this.toolbar?.setZoomPercent(this.cameraController?.getZoomPercent() ?? 100);
      this.roadTool?.update(dt);
      this.updateBuildButtonPosition();
      this.sceneManager?.render(dt, this.cameraController?.getOrbitDistance());
    }
    this.updateFps(time, dt);
    this.animationId = requestAnimationFrame(this.tick);
  };

  private readonly onResize = (): void => {
    this.sceneManager?.resize();
  };

  private syncToolbar(): void {
    if (!this.toolbar || !this.roadNetwork || !this.roadTool || !this.roadSelection) return;
    const stats: ToolbarStats = {
      canBuild: this.roadTool.isDraftBuildable(),
      hasDraft: this.roadTool.hasDraft(),
      mode: this.roadTool.isEnabled() ? 'road' : 'idle',
    };
    this.toolbar.setStats(stats);
    this.updateBuildButtonPosition();
  }

  private updateBuildButtonPosition(): void {
    const roadTool = this.roadTool;
    if (!this.toolbar || !roadTool) return;
    this.toolbar.setBuildButtonPosition(
      roadTool.getBuildButtonPosition(),
      roadTool.isDraftBuildable(),
    );
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

