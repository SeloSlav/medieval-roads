import { CompassHud } from './CompassHud.ts';
import { GameMenu } from './GameMenu.ts';
import type { BurgageLayoutHudState } from '../residences/BurgageTool.ts';
import { isHydrologyOverlayEnabled } from '../scene/hydrologyOverlayPreference.ts';
import {
  dismissDockToggles,
  handleDockHotkey,
  syncDockToggleButton,
  toggleDockControl,
  type DockToggle,
} from './constructionDockToggle.ts';
import { syncTipCardVisibility } from './tipCards.ts';
import { areTipCardsDisabled, setTipCardsDisabled, subscribeTipCardsPreference } from './tipCardsPreference.ts';
import {
  type BuildMenuAction,
  type BuildMenuHandlers,
  BASIC_BUILD_MENU_ENTRIES,
  INDUSTRY_BUILD_MENU_ENTRIES,
  renderBuildMenuCards,
  resolveBuildMenuHotkey,
  runBuildMenuAction,
} from './buildMenuCards.ts';
import { toolbarModeToMenuAction } from './buildMenuMapping.ts';
import type { PlacementBuildMenuAction } from './buildMenuCards.ts';
import type { BuildingKind } from '../generated/gameBalance.ts';
import {
  describeBuilderHelp,
  describeBuilderTitle,
  describeToolbarStatus,
  isBuilderHudMode,
  type ToolbarStats,
} from './buildToolbarStatus.ts';
import { SettlementHud } from './SettlementHud.ts';

export type { ToolbarStats };

const BASIC_BUILD_MENU_ACTIONS = new Set(BASIC_BUILD_MENU_ENTRIES.map((entry) => entry.action));
const INDUSTRY_BUILD_MENU_ACTIONS = new Set(INDUSTRY_BUILD_MENU_ENTRIES.map((entry) => entry.action));

type DeletePopupOptions = {
  clientX: number;
  clientY: number;
  onRemove: () => void;
  onCancel: () => void;
};

export class BuildToolbar {
  private readonly roadButton: HTMLButtonElement;
  private readonly basicBuildMenuButton: HTMLButtonElement;
  private readonly industryBuildMenuButton: HTMLButtonElement;
  private readonly waterOverlayButton: HTMLButtonElement;
  private readonly helpButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly basicBuildMenu: HTMLElement;
  private readonly industryBuildMenu: HTMLElement;
  private readonly burgageLayoutHud: HTMLElement;
  private readonly burgagePlotDecreaseButton: HTMLButtonElement;
  private readonly burgagePlotIncreaseButton: HTMLButtonElement;
  private readonly burgagePlotCountLabel: HTMLElement;
  private readonly burgagePlotMaxLabel: HTMLElement;
  private readonly burgageRotateFrontageButton: HTMLButtonElement;
  private readonly burgageFrontageLabel: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly deletePopup: HTMLElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly cancelDeleteButton: HTMLButtonElement;
  readonly settlementHud: SettlementHud;
  private readonly fpModePanel: HTMLElement;
  private readonly constructionDock: HTMLElement;
  private readonly zoomStat: HTMLElement;
  private readonly builderPanelTitle: HTMLElement;
  private readonly builderHelpList: HTMLElement;
  private readonly builderStatusBar: HTMLElement;
  private readonly root: HTMLElement;
  private readonly compassHud: CompassHud;
  private gameMenu: GameMenu | null = null;
  private readonly unsubscribeTipsPreference: () => void;
  private firstPersonActive = false;
  private basicBuildMenuOpen = false;
  private industryBuildMenuOpen = false;
  private waterOverlayActive = false;
  private buildButtonVisible = false;
  private burgageLayoutHudVisible = false;
  private lastBuildLeft = Number.NaN;
  private lastBuildTop = Number.NaN;
  private lastHudLeft = Number.NaN;
  private lastHudTop = Number.NaN;
  private hudMode: ToolbarStats['mode'] = 'idle';
  private deleteCancel: (() => void) | null = null;
  private deleteRemove: (() => void) | null = null;
  private readonly basicBuildMenuToggle: DockToggle;
  private readonly industryBuildMenuToggle: DockToggle;
  private readonly waterOverlayToggle: DockToggle;
  private readonly dockToggles: DockToggle[];
  private readonly toolbarHandlers: BuildMenuHandlers & {
    onOpenRoads: () => void;
    onSetWaterOverlay?: (active: boolean) => void;
  };
  private gameplayEnabled = true;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || this.firstPersonActive || this.gameMenu?.isOpen()) return;
    if (!this.gameplayEnabled) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const key = event.key.toLowerCase();
    if (key === 'escape') {
      if (dismissDockToggles(this.dockToggles)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (handleDockHotkey(key, this.dockToggles)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (key === 'r' && this.isAnyBuildMenuOpen()) {
      this.closeAllBuildMenus();
      return;
    }
    if (this.basicBuildMenuOpen) {
      const buildAction = resolveBuildMenuHotkey(key, BASIC_BUILD_MENU_ENTRIES);
      if (!buildAction) return;
      event.preventDefault();
      event.stopPropagation();
      runBuildMenuAction(buildAction, this.toolbarHandlers, () => this.setBasicBuildMenuOpen(false));
      return;
    }
    if (!this.industryBuildMenuOpen) return;

    const industryAction = resolveBuildMenuHotkey(key, INDUSTRY_BUILD_MENU_ENTRIES);
    if (!industryAction) return;

    event.preventDefault();
    event.stopPropagation();
    runBuildMenuAction(industryAction, this.toolbarHandlers, () => this.setIndustryBuildMenuOpen(false));
  };

  constructor(
    root: HTMLElement,
    handlers: {
      onOpenRoads: () => void;
      onBuildRoad: () => void;
      onToggleBuilding: (kind: BuildingKind) => void;
      onToggleResidences: () => void;
      onOpenCityAdministration: () => void;
      onSetWaterOverlay?: (active: boolean) => void;
      onBurgagePlotDecrease?: () => void;
      onBurgagePlotIncrease?: () => void;
      onBurgageRotateFrontage?: () => void;
      onMenuOpenChange?: (open: boolean) => void;
      onShadowPreferenceChange?: () => void;
      canOpenMenuFromKeyboard?: () => boolean;
      onNewWorld?: () => void;
    },
  ) {
    root.innerHTML = `
      <div class="hud-right-stack">

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
              <li><span>Build menu</span><span class="road-controls-key">B</span></li>
              <li><span>Industry menu</span><span class="road-controls-key">V</span></li>
              <li><span>Residence</span><span class="road-controls-key">H</span></li>
              <li><span>Well</span><span class="road-controls-key">E</span></li>
              <li><span>Chapel</span><span class="road-controls-key">C</span></li>
              <li><span>Lumber mill</span><span class="road-controls-key">L</span></li>
              <li><span>Stone camp</span><span class="road-controls-key">S</span></li>
              <li><span>Reforester</span><span class="road-controls-key">F</span></li>
              <li><span>Woodcutter</span><span class="road-controls-key">W</span></li>
              <li><span>Hunter's hall</span><span class="road-controls-key">K</span></li>
              <li><span>Forager's shed</span><span class="road-controls-key">Y</span></li>
              <li><span>Marketplace</span><span class="road-controls-key">P</span></li>
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

      <div class="builder-status-bar" data-builder-status hidden aria-live="polite"></div>

      <section class="construction-menu" data-build-menu="basic" hidden aria-label="Build menu">
        <div class="construction-menu__cards">
          ${renderBuildMenuCards(BASIC_BUILD_MENU_ENTRIES)}
        </div>
      </section>

      <section class="construction-menu" data-build-menu="industry" hidden aria-label="Industry menu">
        <div class="construction-menu__cards">
          ${renderBuildMenuCards(INDUSTRY_BUILD_MENU_ENTRIES)}
        </div>
      </section>

      <nav class="construction-dock" data-construction-dock aria-label="Construction tools">
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="road" data-tooltip="Roads (R)" aria-label="Roads (R)" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 21c4.8-4.8 5.2-12.2 1-18" />
            <path d="M15 21c-2.8-5.7-2.2-11.6 2-18" />
            <path d="M12 6.5h1" />
            <path d="M12 11.5h1" />
            <path d="M12 16.5h1" />
          </svg>
          <span class="construction-dock-button__hotkey" aria-hidden="true">R</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="basic-build-menu" data-tooltip="Build (B)" aria-label="Build menu (B)" aria-expanded="false" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.5 5.5l4 4" />
            <path d="M12.3 7.7l4-4 3.9 3.9-4 4" />
            <path d="M14.8 10.8L6.4 19.2a2.1 2.1 0 0 1-3-3l8.4-8.4" />
          </svg>
          <span class="construction-dock-button__hotkey" aria-hidden="true">B</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="industry-build-menu" data-tooltip="Industry (V)" aria-label="Industry menu (V)" aria-expanded="false" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 18h18" />
            <path d="M7 18V11h10v7" />
            <path d="M10 11V8h4v3" />
            <path d="M12 6v2" />
          </svg>
          <span class="construction-dock-button__hotkey" aria-hidden="true">V</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey construction-dock-button--water" data-action="water-overlay" data-tooltip="Water map (M)" aria-label="Water map (M)" aria-pressed="false">
          <span class="construction-dock-button__icon" aria-hidden="true">💧</span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">M</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--text" data-action="help" data-tooltip="Help tips" aria-label="Toggle help tips" aria-pressed="false">
          <span aria-hidden="true">?</span>
        </button>
        <button type="button" class="construction-dock-button" data-action="settings" data-tooltip="Settings" aria-label="Settings">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" />
            <path d="M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5Z" />
          </svg>
        </button>
      </nav>

      <button type="button" class="road-tool-button icon-button floating-build-button" data-action="commit-build" title="Build road (Enter)" aria-label="Build road" disabled hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14.5 5.5l4 4" />
          <path d="M12.3 7.7l4-4 3.9 3.9-4 4" />
          <path d="M14.8 10.8L6.4 19.2a2.1 2.1 0 0 1-3-3l8.4-8.4" />
        </svg>
      </button>

      <div class="burgage-layout-hud" data-burgage-layout-hud hidden aria-label="Residence plot layout">
        <button type="button" class="burgage-layout-hud-button" data-action="burgage-plot-decrease" title="Fewer plots (−)" aria-label="Fewer plots">−</button>
        <div class="burgage-layout-hud-count">
          <strong data-burgage-plot-count>1</strong>
          <span data-burgage-plot-max>plot</span>
        </div>
        <button type="button" class="burgage-layout-hud-button" data-action="burgage-plot-increase" title="More plots (+)" aria-label="More plots">+</button>
        <button type="button" class="burgage-layout-hud-frontage" data-action="burgage-rotate-frontage" title="Rotate frontage (F)" aria-label="Rotate frontage" hidden>
          <span aria-hidden="true">↻</span>
          <span class="burgage-layout-hud-frontage-label" data-burgage-frontage-label>A–B</span>
        </button>
      </div>

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
    const hudStack = this.mustElement(root, '.hud-right-stack');
    this.settlementHud = new SettlementHud(hudStack);
    this.toolbarHandlers = {
      onToggleBuilding: handlers.onToggleBuilding,
      onToggleResidences: handlers.onToggleResidences,
      onOpenRoads: handlers.onOpenRoads,
      onSetWaterOverlay: handlers.onSetWaterOverlay,
    };
    window.addEventListener('keydown', this.onKeyDown, true);
    this.gameMenu = new GameMenu(root, {
      onShadowPreferenceChange: () => handlers.onShadowPreferenceChange?.(),
      onOpenChange: handlers.onMenuOpenChange,
      onOpenCityAdministration: handlers.onOpenCityAdministration,
      canOpenFromKeyboard: handlers.canOpenMenuFromKeyboard,
      onNewWorld: handlers.onNewWorld,
      showButton: false,
    });
    this.unsubscribeTipsPreference = subscribeTipCardsPreference(() => this.syncContextPanels());

    this.roadButton = this.mustButton(root, '[data-action="road"]');
    this.basicBuildMenuButton = this.mustButton(root, '[data-action="basic-build-menu"]');
    this.industryBuildMenuButton = this.mustButton(root, '[data-action="industry-build-menu"]');
    this.waterOverlayButton = this.mustButton(root, '[data-action="water-overlay"]');
    this.helpButton = this.mustButton(root, '[data-action="help"]');
    this.settingsButton = this.mustButton(root, '[data-action="settings"]');
    this.buildButton = this.mustButton(root, '[data-action="commit-build"]');
    this.basicBuildMenu = this.mustElement(root, '[data-build-menu="basic"]');
    this.industryBuildMenu = this.mustElement(root, '[data-build-menu="industry"]');
    this.burgageLayoutHud = this.mustElement(root, '[data-burgage-layout-hud]');
    this.burgagePlotDecreaseButton = this.mustButton(root, '[data-action="burgage-plot-decrease"]');
    this.burgagePlotIncreaseButton = this.mustButton(root, '[data-action="burgage-plot-increase"]');
    this.burgagePlotCountLabel = this.mustElement(root, '[data-burgage-plot-count]');
    this.burgagePlotMaxLabel = this.mustElement(root, '[data-burgage-plot-max]');
    this.burgageRotateFrontageButton = this.mustButton(root, '[data-action="burgage-rotate-frontage"]');
    this.burgageFrontageLabel = this.mustElement(root, '[data-burgage-frontage-label]');
    this.statusLabel = this.mustElement(root, '[data-road-status]');
    this.deletePopup = this.mustElement(root, '[data-delete-popup]');
    this.removeButton = this.mustButton(root, '[data-action="confirm-delete"]');
    this.cancelDeleteButton = this.mustButton(root, '[data-action="cancel-delete"]');
    this.fpModePanel = this.mustElement(root, '[data-fp-mode-panel]');
    this.constructionDock = this.mustElement(root, '[data-construction-dock]');
    this.zoomStat = this.settlementHud.zoomStat;
    this.builderPanelTitle = this.mustElement(root, '[data-road-controls-panel] .road-controls-title');
    this.builderHelpList = this.mustElement(root, '[data-road-controls-panel] .road-controls-list');
    this.builderStatusBar = this.mustElement(root, '[data-builder-status]');
    this.compassHud = new CompassHud(root);
    this.helpButton.setAttribute('aria-pressed', String(!areTipCardsDisabled()));

    this.basicBuildMenuToggle = {
      button: this.basicBuildMenuButton,
      hotkey: 'b',
      getActive: () => this.basicBuildMenuOpen,
      setActive: (active) => this.setBasicBuildMenuOpen(active),
    };
    this.industryBuildMenuToggle = {
      button: this.industryBuildMenuButton,
      hotkey: 'v',
      getActive: () => this.industryBuildMenuOpen,
      setActive: (active) => this.setIndustryBuildMenuOpen(active),
    };
    this.waterOverlayToggle = {
      button: this.waterOverlayButton,
      hotkey: 'm',
      getActive: () => this.waterOverlayActive,
      setActive: (active) => this.applyWaterOverlay(active),
    };
    this.dockToggles = [this.basicBuildMenuToggle, this.industryBuildMenuToggle, this.waterOverlayToggle];
    this.waterOverlayActive = isHydrologyOverlayEnabled();
    for (const toggle of this.dockToggles) {
      syncDockToggleButton(toggle);
    }

    this.syncContextPanels();
    this.roadButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      handlers.onOpenRoads();
    });
    this.basicBuildMenuButton.addEventListener('click', () => toggleDockControl(this.basicBuildMenuToggle));
    this.industryBuildMenuButton.addEventListener('click', () => toggleDockControl(this.industryBuildMenuToggle));
    this.waterOverlayButton.addEventListener('click', () => toggleDockControl(this.waterOverlayToggle));
    this.helpButton.addEventListener('click', () => this.toggleHelpTips());
    this.settingsButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      this.gameMenu?.toggle();
    });
    this.bindBuildMenuClicks(this.basicBuildMenu, () => this.setBasicBuildMenuOpen(false));
    this.bindBuildMenuClicks(this.industryBuildMenu, () => this.setIndustryBuildMenuOpen(false));
    this.buildButton.addEventListener('click', handlers.onBuildRoad);
    this.burgagePlotDecreaseButton.addEventListener('click', () => handlers.onBurgagePlotDecrease?.());
    this.burgagePlotIncreaseButton.addEventListener('click', () => handlers.onBurgagePlotIncrease?.());
    this.burgageRotateFrontageButton.addEventListener('click', () => handlers.onBurgageRotateFrontage?.());
    this.burgageLayoutHud.addEventListener('mousedown', (event) => event.stopPropagation());
    this.burgageLayoutHud.addEventListener('click', (event) => event.stopPropagation());
    this.deletePopup.addEventListener('mousedown', (event) => event.stopPropagation());
    this.deletePopup.addEventListener('click', (event) => event.stopPropagation());
    this.removeButton.addEventListener('click', () => {
      const remove = this.deleteRemove;
      this.hideDeletePopup(false);
      remove?.();
    });
    this.cancelDeleteButton.addEventListener('click', () => this.hideDeletePopup(true));
  }

  setWaterOverlayActive(active: boolean): void {
    this.applyWaterOverlay(active, false);
  }

  setGameplayEnabled(enabled: boolean): void {
    if (this.gameplayEnabled === enabled) return;
    this.gameplayEnabled = enabled;
    this.constructionDock.classList.toggle('is-session-blocked', !enabled);
    this.roadButton.disabled = !enabled;
    this.basicBuildMenuButton.disabled = !enabled;
    this.industryBuildMenuButton.disabled = !enabled;
    this.waterOverlayButton.disabled = !enabled;
    if (!enabled) {
      this.closeAllBuildMenus();
      dismissDockToggles(this.dockToggles);
      if (this.waterOverlayActive) {
        this.applyWaterOverlay(false);
      }
    }
  }

  private applyWaterOverlay(active: boolean, notify = true): void {
    if (this.waterOverlayActive === active) {
      syncDockToggleButton(this.waterOverlayToggle);
      return;
    }
    this.waterOverlayActive = active;
    syncDockToggleButton(this.waterOverlayToggle);
    if (notify) {
      this.toolbarHandlers.onSetWaterOverlay?.(active);
    }
  }

  setStats(stats: ToolbarStats): void {
    this.hudMode = stats.mode;
    const roadMode = stats.mode === 'road';
    this.roadButton.classList.toggle('is-active', roadMode);
    this.roadButton.setAttribute('aria-pressed', String(roadMode));
    this.syncBuildMenuButtons();
    this.syncBuildMenuCardActiveState(stats.mode);
    this.buildButton.disabled = !stats.canBuild;
    this.buildButton.classList.toggle('is-ready', stats.canBuild);
    this.buildButton.classList.toggle('has-draft', stats.hasDraft);
    this.statusLabel.textContent = describeToolbarStatus(stats);
    this.statusLabel.dataset.state = stats.canBuild
      ? 'ready'
      : isBuilderHudMode(stats.mode)
        ? (stats.hasDraft ? 'draft' : 'active')
        : 'idle';
    if (isBuilderHudMode(stats.mode)) {
      this.builderPanelTitle.textContent = describeBuilderTitle(stats.mode);
      this.builderHelpList.innerHTML = describeBuilderHelp(stats.mode);
    }
    const statusText = describeToolbarStatus(stats);
    this.builderStatusBar.textContent = statusText;
    this.builderStatusBar.hidden = !isBuilderHudMode(stats.mode);
    this.builderStatusBar.dataset.state = this.statusLabel.dataset.state;
    this.syncContextPanels();
  }

  setBuildButtonPosition(position: { clientX: number; clientY: number } | null, visible: boolean): void {
    if (!visible || !position) {
      if (!this.buildButtonVisible) return;
      this.buildButton.hidden = true;
      this.buildButtonVisible = false;
      this.lastBuildLeft = Number.NaN;
      this.lastBuildTop = Number.NaN;
      return;
    }

    const size = 44;
    const margin = 10;
    const gap = 12;
    const left = Math.round(Math.max(margin, Math.min(window.innerWidth - size - margin, position.clientX + gap)));
    const top = Math.round(Math.max(margin, Math.min(window.innerHeight - size - margin, position.clientY - size - gap)));
    if (this.buildButtonVisible && left === this.lastBuildLeft && top === this.lastBuildTop) return;

    this.buildButton.hidden = false;
    this.buildButtonVisible = true;
    this.lastBuildLeft = left;
    this.lastBuildTop = top;
    this.buildButton.style.left = `${left}px`;
    this.buildButton.style.top = `${top}px`;
  }

  setBurgageLayoutHud(
    position: { clientX: number; clientY: number } | null,
    state: BurgageLayoutHudState | null,
  ): void {
    if (!position || !state) {
      if (!this.burgageLayoutHudVisible) return;
      this.burgageLayoutHud.hidden = true;
      this.burgageLayoutHudVisible = false;
      this.lastHudLeft = Number.NaN;
      this.lastHudTop = Number.NaN;
      return;
    }

    const plotLabel = state.plotCount === 1 ? 'plot' : 'plots';
    const residenceHint = state.residenceCount != null && state.residenceCount !== state.plotCount
      ? ` · ${state.residenceCount} fit`
      : '';
    this.burgagePlotCountLabel.textContent = state.plotCount.toString();
    this.burgagePlotMaxLabel.textContent = `${plotLabel} / ${state.maxPlotCount} max${residenceHint}`;
    this.burgagePlotDecreaseButton.disabled = !state.canDecrease;
    this.burgagePlotIncreaseButton.disabled = !state.canIncrease;
    this.burgageLayoutHud.dataset.state = state.valid ? 'ready' : 'warning';

    const showFrontage = state.canRotateFrontage && state.frontageLabel != null;
    this.burgageRotateFrontageButton.hidden = !showFrontage;
    if (showFrontage) {
      this.burgageFrontageLabel.textContent = state.frontageLabel;
    }

    this.burgageLayoutHud.hidden = false;
    this.burgageLayoutHudVisible = true;

    const width = this.burgageLayoutHud.offsetWidth || 168;
    const height = this.burgageLayoutHud.offsetHeight || 44;
    const margin = 10;
    const left = Math.round(Math.max(margin, Math.min(window.innerWidth - width - margin, position.clientX - width * 0.5)));
    const top = Math.round(Math.max(margin, Math.min(window.innerHeight - height - margin, position.clientY - height - 14)));
    if (left === this.lastHudLeft && top === this.lastHudTop) return;

    this.lastHudLeft = left;
    this.lastHudTop = top;
    this.burgageLayoutHud.style.left = `${left}px`;
    this.burgageLayoutHud.style.top = `${top}px`;
  }

  setSettlementClock(schedule: Parameters<SettlementHud['setSettlementClock']>[0]): void {
    this.settlementHud.setSettlementClock(schedule);
  }

  setFps(fps: number): void {
    this.settlementHud.setFps(fps);
  }

  setZoomPercent(zoomPercent: number): void {
    this.settlementHud.setZoomPercent(zoomPercent);
  }

  isGameMenuOpen(): boolean {
    return this.gameMenu?.isOpen() ?? false;
  }

  setFirstPersonMode(active: boolean): void {
    this.firstPersonActive = active;
    this.fpModePanel.classList.toggle('is-active', active);
    this.constructionDock.hidden = active;
    this.zoomStat.hidden = active;
    this.compassHud.setVisible(active);
    this.syncContextPanels();
  }

  private syncContextPanels(): void {
    const tipHudMode = isBuilderHudMode(this.hudMode) ? 'road' : 'idle';
    this.helpButton.setAttribute('aria-pressed', String(!areTipCardsDisabled()));
    syncTipCardVisibility(this.root, {
      firstPersonActive: this.firstPersonActive,
      hudMode: tipHudMode,
    });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.unsubscribeTipsPreference();
    this.gameMenu?.dispose();
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

  private isAnyBuildMenuOpen(): boolean {
    return this.basicBuildMenuOpen || this.industryBuildMenuOpen;
  }

  private closeAllBuildMenus(): void {
    this.setBasicBuildMenuOpen(false);
    this.setIndustryBuildMenuOpen(false);
  }

  private setBasicBuildMenuOpen(open: boolean): void {
    if (this.basicBuildMenuOpen === open) return;
    if (open) this.setIndustryBuildMenuOpen(false);
    this.basicBuildMenuOpen = open;
    this.basicBuildMenu.hidden = !open;
    this.basicBuildMenuButton.setAttribute('aria-expanded', String(open));
    this.syncBuildMenuButtons();
  }

  private setIndustryBuildMenuOpen(open: boolean): void {
    if (this.industryBuildMenuOpen === open) return;
    if (open) this.setBasicBuildMenuOpen(false);
    this.industryBuildMenuOpen = open;
    this.industryBuildMenu.hidden = !open;
    this.industryBuildMenuButton.setAttribute('aria-expanded', String(open));
    this.syncBuildMenuButtons();
  }

  private syncBuildMenuButtons(): void {
    const activeAction = toolbarModeToMenuAction(this.hudMode);
    const basicConstruction = activeAction != null && BASIC_BUILD_MENU_ACTIONS.has(activeAction);
    const industryConstruction = activeAction != null && INDUSTRY_BUILD_MENU_ACTIONS.has(activeAction);
    const basicActive = basicConstruction || this.basicBuildMenuOpen;
    const industryActive = industryConstruction || this.industryBuildMenuOpen;

    this.basicBuildMenuButton.classList.toggle('is-active', basicActive);
    this.basicBuildMenuButton.setAttribute('aria-pressed', String(basicActive));
    this.industryBuildMenuButton.classList.toggle('is-active', industryActive);
    this.industryBuildMenuButton.setAttribute('aria-pressed', String(industryActive));
  }

  private syncBuildMenuCardActiveState(mode: ToolbarStats['mode']): void {
    const activeAction = toolbarModeToMenuAction(mode);
    this.syncBuildMenuCards(this.basicBuildMenu, activeAction);
    this.syncBuildMenuCards(this.industryBuildMenu, activeAction);
  }

  private syncBuildMenuCards(menu: HTMLElement, activeAction: PlacementBuildMenuAction | null): void {
    for (const button of menu.querySelectorAll<HTMLButtonElement>('.construction-card[data-action]')) {
      const isActive = button.dataset.action === activeAction;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  private bindBuildMenuClicks(menu: HTMLElement, closeMenu: () => void): void {
    menu.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
      if (!button || !menu.contains(button)) return;
      const action = button.dataset.action as BuildMenuAction | undefined;
      if (!action) return;
      runBuildMenuAction(action, this.toolbarHandlers, closeMenu);
    });
    menu.addEventListener('mousedown', (event) => event.stopPropagation());
    menu.addEventListener('click', (event) => event.stopPropagation());
  }

  private toggleHelpTips(): void {
    const disabled = !areTipCardsDisabled();
    setTipCardsDisabled(disabled);
    this.helpButton.setAttribute('aria-pressed', String(!disabled));
    this.syncContextPanels();
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

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}
