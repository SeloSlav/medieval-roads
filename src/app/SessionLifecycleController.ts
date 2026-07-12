import type { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import type { SessionConnectionGate } from '../network/SessionConnectionGate.ts';
import type { LoadingScreen } from '../ui/LoadingScreen.ts';
import type { SessionConnectionOverlay } from '../ui/SessionConnectionOverlay.ts';
import type { BuildToolbar } from '../ui/BuildToolbar.ts';
import type { RoadTool } from '../roads/RoadTool.ts';
import type { BuildingTool } from '../buildings/BuildingTool.ts';
import type { BurgageTool } from '../residences/BurgageTool.ts';
import type { FirstPersonController } from '../camera/FirstPersonController.ts';

export type SessionLifecycleDeps = {
  sessionGate: SessionConnectionGate;
  loadingScreen: LoadingScreen | null;
  connectionOverlay: SessionConnectionOverlay;
  spacetimeStore: SpacetimeGameStore;
  toolbar: BuildToolbar | null;
  roadTool: RoadTool | null;
  buildingTool: BuildingTool | null;
  burgageTool: BurgageTool | null;
  firstPersonController: FirstPersonController | null;
  recoverSession?: () => void;
};

const DISCONNECT_OVERLAY_DELAY_MS = 4_000;

export class SessionLifecycleController {
  private reconnectTimer: number | null = null;
  private disconnectOverlayTimer: number | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private readonly deps: SessionLifecycleDeps;

  constructor(deps: SessionLifecycleDeps) {
    this.deps = deps;
    this.unsubscribeStore = deps.spacetimeStore.subscribe((snapshot) => {
      this.onStoreSnapshot(snapshot.connected && snapshot.identityHex !== null);
    });
  }

  dispose(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.clearReconnectTimer();
    this.clearDisconnectOverlayTimer();
  }

  onReady(): void {
    this.deps.sessionGate.markReady();
    // Overlay stays until App finishes finishVegetation() and calls onPresentationReady().
    this.deps.loadingScreen?.setProgress({
      label: 'Growing forest…',
      detail: 'Building trees and ground cover',
    });
    this.deps.connectionOverlay.hide();
    this.deps.toolbar?.setGameplayEnabled(true);
    this.clearReconnectTimer();
    this.clearDisconnectOverlayTimer();
  }

  onPresentationReady(): void {
    this.deps.loadingScreen?.dismiss();
  }

  onBootstrapFailed(error: unknown, retry: () => void): void {
    const message = error instanceof Error ? error.message : 'World bootstrap failed.';
    this.deps.loadingScreen?.setErrorState(
      { label: 'World bootstrap failed', detail: message },
      retry,
    );
  }

  onWorldGenerationMismatch(message: string, retry: () => void): void {
    this.deps.sessionGate.markBlocked(message);
    this.deps.loadingScreen?.setErrorState(
      { label: 'World settings mismatch', detail: message },
      retry,
    );
  }

  onBootConnectionFailure(): void {
    if (this.deps.spacetimeStore.isConnected) {
      this.deps.recoverSession?.();
      return;
    }
    if (this.deps.sessionGate.hasEverBeenReady()) {
      this.scheduleDisconnectOverlay();
      this.scheduleReconnect();
      return;
    }
    this.deps.loadingScreen?.setErrorState(
      {
        label: 'SpacetimeDB unavailable',
        detail: 'Run `spacetime start` and `npm run deploy:local`, then retry.',
      },
      () => this.retryConnection(),
    );
    this.scheduleReconnect();
  }

  retryConnection(): void {
    this.deps.sessionGate.markConnecting();
    this.deps.loadingScreen?.setProgress({
      label: 'Connecting…',
      detail: 'Retrying SpacetimeDB connection',
    });
    try {
      this.deps.spacetimeStore.connect();
    } catch (error) {
      console.warn('[SessionLifecycle] SpacetimeDB reconnect failed:', error);
    }
    this.scheduleReconnect();
  }

  private onStoreSnapshot(transportLive: boolean): void {
    if (transportLive) {
      this.clearDisconnectOverlayTimer();
      this.deps.connectionOverlay.hide();
      if (!this.deps.sessionGate.isReady()) {
        this.deps.recoverSession?.();
      }
      return;
    }

    if (!this.deps.sessionGate.hasEverBeenReady()) {
      return;
    }

    this.scheduleDisconnectOverlay();
    if (this.deps.sessionGate.isReady()) {
      this.deps.sessionGate.markDisconnected();
      this.deactivateAllTools();
      this.deps.toolbar?.setGameplayEnabled(false);
    }
    this.scheduleReconnect();
  }

  private scheduleDisconnectOverlay(): void {
    if (this.disconnectOverlayTimer !== null) return;
    this.disconnectOverlayTimer = window.setTimeout(() => {
      this.disconnectOverlayTimer = null;
      if (this.deps.spacetimeStore.isConnected) {
        this.deps.recoverSession?.();
        this.deps.connectionOverlay.hide();
        return;
      }
      this.deps.connectionOverlay.show(
        'Connection lost',
        'Retrying SpacetimeDB connection…',
      );
    }, DISCONNECT_OVERLAY_DELAY_MS);
  }

  private clearDisconnectOverlayTimer(): void {
    if (this.disconnectOverlayTimer === null) return;
    window.clearTimeout(this.disconnectOverlayTimer);
    this.disconnectOverlayTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.deps.sessionGate.isReady()) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.deps.sessionGate.isReady()) return;
      if (this.deps.spacetimeStore.isConnected) {
        this.deps.recoverSession?.();
      } else {
        try {
          this.deps.spacetimeStore.connect();
        } catch (error) {
          console.warn('[SessionLifecycle] SpacetimeDB reconnect failed:', error);
        }
      }
      if (!this.deps.sessionGate.isReady()) {
        this.scheduleReconnect();
      }
    }, 3000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private deactivateAllTools(): void {
    this.deps.roadTool?.setEnabled(false);
    this.deps.buildingTool?.setMode('off');
    this.deps.burgageTool?.setEnabled(false);
    if (this.deps.firstPersonController?.isActive()) {
      this.deps.firstPersonController.deactivate();
    }
  }
}
