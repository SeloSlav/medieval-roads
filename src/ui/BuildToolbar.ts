export type ToolbarStats = {
  canBuild: boolean;
  hasDraft: boolean;
  mode: 'road' | 'idle';
};

type DeletePopupOptions = {
  clientX: number;
  clientY: number;
  onRemove: () => void;
  onCancel: () => void;
};

export class BuildToolbar {
  private readonly roadButton: HTMLButtonElement;
  private readonly roadControlsPanel: HTMLElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly statusLabel: HTMLElement;
  private readonly deletePopup: HTMLElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly cancelDeleteButton: HTMLButtonElement;
  private readonly fpsPanel: HTMLElement;
  private readonly fpsValue: HTMLElement;
  private readonly zoomValue: HTMLElement;
  private deleteCancel: (() => void) | null = null;
  private deleteRemove: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    handlers: {
      onOpenRoads: () => void;
      onBuildRoad: () => void;
    },
  ) {
    root.innerHTML = `
      <aside class="road-controls-panel" data-road-controls-panel aria-label="Road placement instructions" hidden>
        <header class="road-controls-header">
          <div>
            <p class="road-controls-eyebrow">Builder</p>
            <h2 class="road-controls-title">Roads</h2>
            <p class="road-controls-status" data-road-status>Road tool off</p>
          </div>
        </header>

        <section class="road-controls-help" aria-label="Road placement shortcuts">
          <h3 class="road-controls-help-title">Controls</h3>
          <ul class="road-controls-list">
            <li><span>Toggle road tool</span><span class="road-controls-key">R</span></li>
            <li><span>Place point</span><span class="road-controls-key">L-click</span></li>
            <li><span>Undo last point</span><span class="road-controls-key">R-click</span></li>
            <li><span>Curve segment</span><span class="road-controls-key">Ctrl + scroll</span></li>
            <li><span>Build road</span><span class="road-controls-key">Hammer or Enter</span></li>
            <li><span>Delete segment</span><span class="road-controls-key">Alt + L-click</span></li>
            <li><span>Undo change</span><span class="road-controls-key">Ctrl + Z</span></li>
            <li><span>Cancel / exit</span><span class="road-controls-key">Esc</span></li>
          </ul>
        </section>
      </aside>

      <div class="road-tools" aria-label="Road tools">
        <button type="button" class="road-tool-button" data-action="road" title="Roads (R)">
          Roads <span class="road-tool-button-key">(R)</span>
        </button>
      </div>

      <button type="button" class="road-tool-button icon-button floating-build-button" data-action="build" title="Build road (Enter)" aria-label="Build road" disabled hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14.5 5.5l4 4" />
          <path d="M12.3 7.7l4-4 3.9 3.9-4 4" />
          <path d="M14.8 10.8L6.4 19.2a2.1 2.1 0 0 1-3-3l8.4-8.4" />
        </svg>
      </button>

      <div class="delete-popup" data-delete-popup hidden>
        <button type="button" data-action="confirm-delete">Remove</button>
        <button type="button" class="ghost-button" data-action="cancel-delete">Cancel</button>
      </div>

      <div class="fps-panel" data-fps-panel aria-live="polite">
        <div class="fps-stat">
          <strong data-stat="fps">--</strong>
          <span>FPS</span>
        </div>
        <div class="fps-stat">
          <strong data-stat="zoom">100%</strong>
          <span>Zoom</span>
        </div>
      </div>
    `;

    this.roadButton = this.mustButton(root, '[data-action="road"]');
    this.roadControlsPanel = this.mustElement(root, '[data-road-controls-panel]');
    this.buildButton = this.mustButton(root, '[data-action="build"]');
    this.statusLabel = this.mustElement(root, '[data-road-status]');
    this.deletePopup = this.mustElement(root, '[data-delete-popup]');
    this.removeButton = this.mustButton(root, '[data-action="confirm-delete"]');
    this.cancelDeleteButton = this.mustButton(root, '[data-action="cancel-delete"]');
    this.fpsPanel = this.mustElement(root, '[data-fps-panel]');
    this.fpsValue = this.mustElement(root, '[data-stat="fps"]');
    this.zoomValue = this.mustElement(root, '[data-stat="zoom"]');

    this.roadButton.addEventListener('click', handlers.onOpenRoads);
    this.buildButton.addEventListener('click', handlers.onBuildRoad);
    this.deletePopup.addEventListener('mousedown', (event) => event.stopPropagation());
    this.deletePopup.addEventListener('click', (event) => event.stopPropagation());
    this.removeButton.addEventListener('click', () => {
      const remove = this.deleteRemove;
      this.hideDeletePopup(false);
      remove?.();
    });
    this.cancelDeleteButton.addEventListener('click', () => this.hideDeletePopup(true));
  }

  setStats(stats: ToolbarStats): void {
    const roadMode = stats.mode === 'road';
    this.roadControlsPanel.hidden = !roadMode;
    this.roadButton.classList.toggle('is-active', roadMode);
    this.roadButton.setAttribute('aria-pressed', String(roadMode));
    this.buildButton.disabled = !stats.canBuild;
    this.buildButton.classList.toggle('is-ready', stats.canBuild);
    this.buildButton.classList.toggle('has-draft', stats.hasDraft);
    this.statusLabel.textContent = this.describeStatus(stats);
    this.statusLabel.dataset.state = stats.canBuild ? 'ready' : roadMode ? (stats.hasDraft ? 'draft' : 'active') : 'idle';
  }

  setBuildButtonPosition(position: { clientX: number; clientY: number } | null, visible: boolean): void {
    if (!visible || !position) {
      this.buildButton.hidden = true;
      return;
    }

    const size = 44;
    const margin = 10;
    const gap = 12;
    const left = Math.max(margin, Math.min(window.innerWidth - size - margin, position.clientX + gap));
    const top = Math.max(margin, Math.min(window.innerHeight - size - margin, position.clientY - size - gap));
    this.buildButton.hidden = false;
    this.buildButton.style.left = `${left}px`;
    this.buildButton.style.top = `${top}px`;
  }

  setFps(fps: number): void {
    const displayFps = Math.min(90, Math.round(fps));
    this.fpsValue.textContent = displayFps.toString();
    this.fpsPanel.classList.toggle('is-low', displayFps < 60);
    this.fpsPanel.classList.toggle('is-fast', displayFps >= 85);
  }

  setZoomPercent(zoomPercent: number): void {
    const displayZoom = Math.max(1, Math.round(zoomPercent));
    this.zoomValue.textContent = `${displayZoom}%`;
  }

  showDeletePopup(options: DeletePopupOptions): void {
    this.deleteCancel = options.onCancel;
    this.deleteRemove = options.onRemove;
    const width = 168;
    const height = 44;
    const margin = 10;
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, options.clientX + 12));
    const top = Math.max(margin, Math.min(window.innerHeight - height - margin, options.clientY - height * 0.5));
    this.deletePopup.style.left = `${left}px`;
    this.deletePopup.style.top = `${top}px`;
    this.deletePopup.hidden = false;
    this.removeButton.focus({ preventScroll: true });
  }

  hideDeletePopup(runCancel = true): void {
    if (this.deletePopup.hidden) return;
    const cancel = this.deleteCancel;
    this.deletePopup.hidden = true;
    this.deleteCancel = null;
    this.deleteRemove = null;
    if (runCancel) cancel?.();
  }

  private describeStatus(stats: ToolbarStats): string {
    if (stats.mode !== 'road') return 'Road tool off';
    if (stats.canBuild) return 'Ready to build';
    if (stats.hasDraft) return 'Add more points';
    return 'Click terrain to start';
  }

  private mustButton(root: HTMLElement, selector: string): HTMLButtonElement {
    const element = root.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Missing toolbar button ${selector}`);
    return element;
  }

  private mustElement(root: HTMLElement, selector: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing toolbar element ${selector}`);
    return element;
  }
}
