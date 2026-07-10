import { CompassHud } from './CompassHud.ts';
import { GameMenu } from './GameMenu.ts';
import { syncTipCardVisibility } from './tipCards.ts';
import { subscribeTipCardsPreference } from './tipCardsPreference.ts';

export type ToolbarStats = {
  canBuild: boolean;
  hasDraft: boolean;
  mode: 'road' | 'lumber_mill' | 'reforester' | 'stone_quarry' | 'idle';
};

type DeletePopupOptions = {
  clientX: number;
  clientY: number;
  onRemove: () => void;
  onCancel: () => void;
};

export class BuildToolbar {
  private readonly roadButton: HTMLButtonElement;
  private readonly lumberMillButton: HTMLButtonElement;
  private readonly reforesterButton: HTMLButtonElement;
  private readonly stoneQuarryButton: HTMLButtonElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly statusLabel: HTMLElement;
  private readonly deletePopup: HTMLElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly cancelDeleteButton: HTMLButtonElement;
  private readonly fpsPanel: HTMLElement;
  private readonly fpsValue: HTMLElement;
  private readonly zoomValue: HTMLElement;
  private readonly fpModePanel: HTMLElement;
  private readonly roadTools: HTMLElement;
  private readonly zoomStat: HTMLElement;
  private readonly root: HTMLElement;
  private readonly compassHud: CompassHud;
  private readonly gameMenu: GameMenu;
  private readonly unsubscribeTipsPreference: () => void;
  private firstPersonActive = false;
  private hudMode: ToolbarStats['mode'] = 'idle';
  private deleteCancel: (() => void) | null = null;
  private deleteRemove: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    handlers: {
      onOpenRoads: () => void;
      onBuildRoad: () => void;
      onToggleLumberMill: () => void;
      onToggleReforester: () => void;
      onToggleStoneQuarry: () => void;
      onMenuOpenChange?: (open: boolean) => void;
      canOpenMenuFromKeyboard?: () => boolean;
      onExportGameState?: () => void;
      onImportGameState?: () => void;
    },
  ) {
    root.innerHTML = `
      <div class="hud-right-stack">
        <div class="fps-panel" data-fps-panel aria-live="polite">
          <div class="fps-stat">
            <strong data-stat="fps">--</strong>
            <span>FPS</span>
          </div>
          <div class="fps-stat" data-stat-row="zoom">
            <strong data-stat="zoom">100%</strong>
            <span>Zoom</span>
          </div>
        </div>

        <aside class="fp-controls-panel" data-tip-card="fp" data-fp-controls-panel aria-label="Walk mode controls" hidden>
          <header class="road-controls-header">
            <div>
              <p class="road-controls-eyebrow">Explorer</p>
              <h2 class="road-controls-title">Walk mode</h2>
            </div>
          </header>

          <section class="road-controls-help" aria-label="Walk mode shortcuts">
            <h3 class="road-controls-help-title">Controls</h3>
            <ul class="road-controls-list">
              <li><span>Move</span><span class="road-controls-key">WASD</span></li>
              <li><span>Sprint</span><span class="road-controls-key">Shift</span></li>
              <li><span>Jump</span><span class="road-controls-key">Space</span></li>
              <li><span>Crouch</span><span class="road-controls-key">C</span></li>
              <li><span>Free look</span><span class="road-controls-key">Alt</span></li>
              <li><span>Toggle walk</span><span class="road-controls-key">~</span></li>
              <li><span>Exit walk</span><span class="road-controls-key">Esc</span></li>
            </ul>
          </section>
        </aside>

        <aside class="rts-controls-panel" data-tip-card="rts" data-rts-controls-panel aria-label="Camera controls" hidden>
          <header class="road-controls-header">
            <div>
              <p class="road-controls-eyebrow">Strategist</p>
              <h2 class="road-controls-title">Camera</h2>
            </div>
          </header>

          <section class="road-controls-help" aria-label="Camera shortcuts">
            <h3 class="road-controls-help-title">Controls</h3>
            <ul class="road-controls-list">
              <li><span>Pan map</span><span class="road-controls-key">R-drag / WASD</span></li>
              <li><span>Rotate view</span><span class="road-controls-key">MMB / Q E</span></li>
              <li><span>Zoom</span><span class="road-controls-key">Scroll</span></li>
              <li><span>Open menu</span><span class="road-controls-key">Esc</span></li>
              <li><span>Walk mode</span><span class="road-controls-key">~</span></li>
              <li><span>Road tool</span><span class="road-controls-key">R</span></li>
            </ul>
          </section>
        </aside>

        <aside class="road-controls-panel" data-tip-card="road" data-road-controls-panel aria-label="Road placement instructions" hidden>
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
              <li><span>Redo change</span><span class="road-controls-key">Ctrl + Y</span></li>
              <li><span>Cancel / exit</span><span class="road-controls-key">Esc</span></li>
            </ul>
          </section>
        </aside>
      </div>

      <div class="road-tools" aria-label="Build tools">
        <button type="button" class="road-tool-button" data-action="road" title="Roads (R)">
          Roads <span class="road-tool-button-key">(R)</span>
        </button>
        <button type="button" class="road-tool-button" data-action="lumber-mill" title="Place lumber mill">
          Lumber mill
        </button>
        <button type="button" class="road-tool-button" data-action="reforester" title="Place reforester">
          Reforester
        </button>
        <button type="button" class="road-tool-button" data-action="stone-quarry" title="Place stone quarry">
          Stone quarry
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

      <div class="hud-bottom-right">
        <div class="fps-panel fp-mode-panel" data-fp-mode-panel aria-label="First person mode">
          <div class="fps-stat">
            <strong>~</strong>
            <span>Walk</span>
          </div>
        </div>
      </div>

    `;

    this.root = root;
    this.gameMenu = new GameMenu(root, {
      onTipsPreferenceChange: () => this.syncContextPanels(),
      onOpenChange: handlers.onMenuOpenChange,
      canOpenFromKeyboard: handlers.canOpenMenuFromKeyboard,
      onExportGameState: handlers.onExportGameState,
      onImportGameState: handlers.onImportGameState,
    });
    this.unsubscribeTipsPreference = subscribeTipCardsPreference(() => this.syncContextPanels());

    this.roadButton = this.mustButton(root, '[data-action="road"]');
    this.lumberMillButton = this.mustButton(root, '[data-action="lumber-mill"]');
    this.reforesterButton = this.mustButton(root, '[data-action="reforester"]');
    this.stoneQuarryButton = this.mustButton(root, '[data-action="stone-quarry"]');
    this.buildButton = this.mustButton(root, '[data-action="build"]');
    this.statusLabel = this.mustElement(root, '[data-road-status]');
    this.deletePopup = this.mustElement(root, '[data-delete-popup]');
    this.removeButton = this.mustButton(root, '[data-action="confirm-delete"]');
    this.cancelDeleteButton = this.mustButton(root, '[data-action="cancel-delete"]');
    this.fpsPanel = this.mustElement(root, '[data-fps-panel]');
    this.fpsValue = this.mustElement(root, '[data-stat="fps"]');
    this.zoomValue = this.mustElement(root, '[data-stat="zoom"]');
    this.fpModePanel = this.mustElement(root, '[data-fp-mode-panel]');
    this.roadTools = this.mustElement(root, '.road-tools');
    this.zoomStat = this.mustElement(root, '[data-stat-row="zoom"]');
    this.compassHud = new CompassHud(root);

    this.syncContextPanels();
    this.roadButton.addEventListener('click', handlers.onOpenRoads);
    this.lumberMillButton.addEventListener('click', handlers.onToggleLumberMill);
    this.reforesterButton.addEventListener('click', handlers.onToggleReforester);
    this.stoneQuarryButton.addEventListener('click', handlers.onToggleStoneQuarry);
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
    this.hudMode = stats.mode;
    const roadMode = stats.mode === 'road';
    const lumberMode = stats.mode === 'lumber_mill';
    const reforesterMode = stats.mode === 'reforester';
    const stoneQuarryMode = stats.mode === 'stone_quarry';
    this.roadButton.classList.toggle('is-active', roadMode);
    this.roadButton.setAttribute('aria-pressed', String(roadMode));
    this.lumberMillButton.classList.toggle('is-active', lumberMode);
    this.lumberMillButton.setAttribute('aria-pressed', String(lumberMode));
    this.reforesterButton.classList.toggle('is-active', reforesterMode);
    this.reforesterButton.setAttribute('aria-pressed', String(reforesterMode));
    this.stoneQuarryButton.classList.toggle('is-active', stoneQuarryMode);
    this.stoneQuarryButton.setAttribute('aria-pressed', String(stoneQuarryMode));
    this.buildButton.disabled = !stats.canBuild;
    this.buildButton.classList.toggle('is-ready', stats.canBuild);
    this.buildButton.classList.toggle('has-draft', stats.hasDraft);
    this.statusLabel.textContent = this.describeStatus(stats);
    this.statusLabel.dataset.state = stats.canBuild ? 'ready' : roadMode ? (stats.hasDraft ? 'draft' : 'active') : 'idle';
    this.syncContextPanels();
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

  isGameMenuOpen(): boolean {
    return this.gameMenu.isOpen();
  }

  setFirstPersonMode(active: boolean): void {
    this.firstPersonActive = active;
    this.fpModePanel.classList.toggle('is-active', active);
    this.roadTools.hidden = active;
    this.zoomStat.hidden = active;
    this.compassHud.setVisible(active);
    this.syncContextPanels();
  }

  private syncContextPanels(): void {
    const tipHudMode = this.hudMode === 'road' ? 'road' : 'idle';
    syncTipCardVisibility(this.root, {
      firstPersonActive: this.firstPersonActive,
      hudMode: tipHudMode,
    });
  }

  dispose(): void {
    this.unsubscribeTipsPreference();
    this.gameMenu.dispose();
    this.compassHud.dispose();
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
    if (stats.mode === 'lumber_mill') return 'Click terrain to place a lumber mill (one at a time)';
    if (stats.mode === 'reforester') return 'Click terrain to place a reforester (one at a time)';
    if (stats.mode === 'stone_quarry') return 'Click terrain to place a stone quarry (one at a time)';
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
