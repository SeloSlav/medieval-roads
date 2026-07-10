/// <reference types="vite/client" />
/**
 * SpacetimeDB game store — replicated game state from server tables.
 * Data flow: SpacetimeDB → store → App / ForestVisualSync / RoadNetwork.
 */

import type { DbConnection } from '../generated/index.ts';
import type {
  Building,
  BurgageZone,
  PlayerResources,
  Quarry,
  Residence,
  TreeEntity,
} from '../generated/types.ts';
import {
  clearStoredSpacetimeToken,
  getStoredSpacetimeToken,
  setStoredSpacetimeToken,
} from '../network/identityPersistence.ts';
import {
  connect,
  getConnection,
  getSpacetimeConfig,
  isConnected,
  isUnauthorizedConnectError,
} from '../network/spacetimedbClient.ts';
import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';
import type {
  BuildingKind,
  BuildingState,
  BurgageFrontageEdge,
  BurgageZoneState,
  GameState,
  QuarryNodeState,
  ResidenceState,
  ResourceStockpile,
  TreeEntityState,
  TreePhase,
} from '../resources/types.ts';
import { createEmptyStockpile, isBuildingKind, isTreePhase } from '../resources/types.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';

export type SpacetimeGameSnapshot = {
  connected: boolean;
  identityHex: string | null;
  stockpile: ResourceStockpile;
  quarries: Map<string, QuarryNodeState>;
  trees: Map<string, TreeEntityState>;
  buildings: Map<string, BuildingState>;
  burgageZones: Map<string, BurgageZoneState>;
  residences: Map<string, ResidenceState>;
  roads: RoadNetworkSnapshot | null;
  simTick: number;
};

export type SpacetimeGameStoreListener = (snapshot: SpacetimeGameSnapshot) => void;

const EMPTY_ROAD_SNAPSHOT: RoadNetworkSnapshot = {
  nextNodeId: 1,
  nextEdgeId: 1,
  nodes: [],
  edges: [],
};

export class SpacetimeGameStore {
  private connection: DbConnection | null = null;
  private identityHex: string | null = null;
  private readonly listeners = new Set<SpacetimeGameStoreListener>();
  private stockpile: ResourceStockpile = createEmptyStockpile();
  private quarries = new Map<string, QuarryNodeState>();
  private trees = new Map<string, TreeEntityState>();
  private buildings = new Map<string, BuildingState>();
  private burgageZones = new Map<string, BurgageZoneState>();
  private residences = new Map<string, ResidenceState>();
  private roads: RoadNetworkSnapshot | null = null;
  private simTick = 0;
  private roadSyncTimer: number | null = null;
  private pendingRoadSnapshot: string | null = null;

  get isConnected(): boolean {
    return isConnected();
  }

  hasServerQuarries(): boolean {
    return this.serverQuarryCount() > 0;
  }

  hasServerTrees(): boolean {
    return this.serverTreeCount() > 0;
  }

  get snapshot(): SpacetimeGameSnapshot {
    return {
      connected: this.isConnected,
      identityHex: this.identityHex,
      stockpile: { ...this.stockpile },
      quarries: new Map(this.quarries),
      trees: new Map(this.trees),
      buildings: new Map(this.buildings),
      burgageZones: new Map(this.burgageZones),
      residences: new Map(this.residences),
      roads: this.roads ? structuredClone(this.roads) : null,
      simTick: this.simTick,
    };
  }

  subscribe(listener: SpacetimeGameStoreListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  connect(): DbConnection {
    return this.connectWithOptionalToken(getStoredSpacetimeToken(getSpacetimeConfig().dbName) ?? undefined, false);
  }

  private connectWithOptionalToken(token: string | undefined, isRetry: boolean): DbConnection {
    const { dbName } = getSpacetimeConfig();

    this.connection = connect(token, {
      onIdentity: (identity) => {
        this.identityHex = identity.toHexString();
        this.startSubscriptions();
        this.emit();
      },
      onToken: (serverToken) => {
        setStoredSpacetimeToken(dbName, serverToken);
      },
      onConnectError: (error) => {
        if (!isRetry && isUnauthorizedConnectError(error)) {
          clearStoredSpacetimeToken(dbName);
          console.warn('[SpacetimeGameStore] Stale token cleared, retrying anonymous connect');
          this.connectWithOptionalToken(undefined, true);
          return;
        }
        console.warn('[SpacetimeGameStore] connect error', error);
        this.emit();
      },
      onDisconnect: () => {
        this.identityHex = null;
        this.emit();
      },
    });
    return this.connection;
  }

  /** @deprecated Use {@link connect} — tokens are server-issued, not client-generated. */
  connectWithToken(token: string): DbConnection {
    return this.connectWithOptionalToken(token, false);
  }

  toGameState(seed: number, registry: WorldLayoutRegistry): GameState {
    const quarries = new Map(this.quarries);
    if (!this.isConnected) {
      for (const definition of registry.definitionList) {
        if (quarries.has(definition.id)) continue;
        quarries.set(definition.id, {
          nodeId: definition.id,
          kind: definition.kind,
          resource: definition.resource,
          remaining: definition.maxYield,
          maxYield: definition.maxYield,
          x: definition.x,
          z: definition.z,
        });
      }
    }

    return {
      seed,
      tick: this.simTick,
      stockpile: { ...this.stockpile },
      quarries,
      trees: new Map(this.trees),
      buildings: new Map(this.buildings),
      burgageZones: new Map(this.burgageZones),
      residences: new Map(this.residences),
      nextBuildingId: inferNextBuildingId(this.buildings),
    };
  }

  async placeBurgageZone(input: {
    corners: Array<{ x: number; z: number }>;
    frontageEdge: BurgageFrontageEdge;
    plotCount: number;
  }): Promise<void> {
    const [a, b, c, d] = input.corners;
    await this.callReducer('placeBurgageZone', 'place_burgage_zone', {
      cornerAx: a.x,
      cornerAz: a.z,
      cornerBx: b.x,
      cornerBz: b.z,
      cornerCx: c.x,
      cornerCz: c.z,
      cornerDx: d.x,
      cornerDz: d.z,
      frontageEdge: input.frontageEdge,
      plotCount: input.plotCount,
    });
  }

  async demolishBurgageZone(zoneId: string): Promise<void> {
    const serverId = parseZoneServerId(zoneId);
    if (serverId === null) {
      throw new Error('Invalid residence zone id.');
    }
    await this.callReducer('demolishBurgageZone', 'demolish_burgage_zone', { zoneId: serverId });
  }

  async placeBuilding(kind: BuildingKind, x: number, z: number): Promise<void> {
    await this.callReducer('placeBuilding', 'place_building', { kind, x, z });
  }

  async demolishBuilding(buildingId: string): Promise<void> {
    const serverId = parseBuildingServerId(buildingId);
    if (serverId === null) {
      throw new Error('Invalid building id.');
    }
    await this.callReducer('demolishBuilding', 'demolish_building', { buildingId: serverId });
  }

  async bootstrapWorld(registry: WorldLayoutRegistry): Promise<void> {
    const quarries = registry.definitionList.map((definition) => ({
      quarryId: definition.id,
      x: definition.x,
      z: definition.z,
      maxYield: definition.maxYield,
    }));
    await this.callReducer('bootstrapQuarries', 'bootstrap_quarries', { quarries });
  }

  queueRoadSync(snapshot: RoadNetworkSnapshot): void {
    this.pendingRoadSnapshot = JSON.stringify(snapshot);
    if (this.roadSyncTimer !== null) return;
    this.roadSyncTimer = window.setTimeout(() => {
      this.roadSyncTimer = null;
      void this.flushRoadSync();
    }, 120);
  }

  async syncRoadNetworkNow(snapshot: RoadNetworkSnapshot): Promise<void> {
    this.pendingRoadSnapshot = JSON.stringify(snapshot);
    await this.flushRoadSync();
  }

  private async flushRoadSync(): Promise<void> {
    if (!this.connection || !this.pendingRoadSnapshot) return;
    const snapshotJson = this.pendingRoadSnapshot;
    this.pendingRoadSnapshot = null;
    await this.callReducer('syncRoadNetwork', 'sync_road_network', { snapshotJson });
  }

  private serverTreeCount(): number {
    const connection = getConnection();
    if (!connection) return 0;
    const table = (connection.db as { tree_entity?: { iter: () => Iterable<unknown> } }).tree_entity;
    return table ? [...table.iter()].length : 0;
  }

  private serverQuarryCount(): number {
    const connection = getConnection();
    if (!connection) return 0;
    const table = (connection.db as { quarry?: { iter: () => Iterable<unknown> } }).quarry;
    return table ? [...table.iter()].length : 0;
  }

  private startSubscriptions(): void {
    const connection = getConnection();
    if (!connection) return;

    connection.subscriptionBuilder().subscribe('SELECT * FROM world_config');
    connection.subscriptionBuilder().subscribe('SELECT * FROM player_resources');
    connection.subscriptionBuilder().subscribe('SELECT * FROM quarry');
    connection.subscriptionBuilder().subscribe('SELECT * FROM tree_entity');
    connection.subscriptionBuilder().subscribe('SELECT * FROM building');
    connection.subscriptionBuilder().subscribe('SELECT * FROM burgage_zone');
    connection.subscriptionBuilder().subscribe('SELECT * FROM residence');
    connection.subscriptionBuilder().subscribe('SELECT * FROM road_network_state');

    this.syncAllFromDb(connection);
    this.attachTableHandlers(connection);
  }

  private attachTableHandlers(connection: DbConnection): void {
    const db = connection.db as {
      world_config?: TableHandle;
      player_resources?: TableHandle;
      quarry?: TableHandle;
      tree_entity?: TableHandle;
      building?: TableHandle;
      burgage_zone?: TableHandle;
      residence?: TableHandle;
      road_network_state?: TableHandle;
    };

    db.world_config?.onInsert(() => this.syncAllFromDb(connection));
    db.world_config?.onUpdate(() => this.syncAllFromDb(connection));
    db.player_resources?.onInsert(() => this.syncAllFromDb(connection));
    db.player_resources?.onUpdate(() => this.syncAllFromDb(connection));
    db.quarry?.onInsert(() => this.syncAllFromDb(connection));
    db.quarry?.onUpdate(() => this.syncAllFromDb(connection));
    db.quarry?.onDelete(() => this.syncAllFromDb(connection));
    db.tree_entity?.onInsert(() => this.syncAllFromDb(connection));
    db.tree_entity?.onUpdate(() => this.syncAllFromDb(connection));
    db.tree_entity?.onDelete(() => this.syncAllFromDb(connection));
    db.building?.onInsert(() => this.syncAllFromDb(connection));
    db.building?.onUpdate(() => this.syncAllFromDb(connection));
    db.building?.onDelete(() => this.syncAllFromDb(connection));
    db.burgage_zone?.onInsert(() => this.syncAllFromDb(connection));
    db.burgage_zone?.onUpdate(() => this.syncAllFromDb(connection));
    db.burgage_zone?.onDelete(() => this.syncAllFromDb(connection));
    db.residence?.onInsert(() => this.syncAllFromDb(connection));
    db.residence?.onUpdate(() => this.syncAllFromDb(connection));
    db.residence?.onDelete(() => this.syncAllFromDb(connection));
    db.road_network_state?.onInsert(() => this.syncAllFromDb(connection));
    db.road_network_state?.onUpdate(() => this.syncAllFromDb(connection));
    db.road_network_state?.onDelete(() => this.syncAllFromDb(connection));
  }

  private syncAllFromDb(connection: DbConnection): void {
    const db = connection.db as {
      world_config?: { iter: () => Iterable<{ simTick: bigint | number }> };
      player_resources?: { iter: () => Iterable<PlayerResources> };
      quarry?: { iter: () => Iterable<Quarry> };
      tree_entity?: { iter: () => Iterable<TreeEntity> };
      building?: { iter: () => Iterable<Building> };
      burgage_zone?: { iter: () => Iterable<BurgageZone> };
      residence?: { iter: () => Iterable<Residence> };
      road_network_state?: { iter: () => Iterable<{ owner: { toHexString: () => string }; snapshotJson: string }> };
    };

    const worldRows = db.world_config ? [...db.world_config.iter()] : [];
    if (worldRows.length > 0) {
      this.simTick = Number(worldRows[0].simTick);
    }

    this.stockpile = createEmptyStockpile();
    if (db.player_resources && this.identityHex) {
      for (const row of db.player_resources.iter()) {
        if (row.owner.toHexString() !== this.identityHex) continue;
        this.stockpile = {
          wood: row.wood,
          stone: row.stone,
          water: row.water,
        };
        break;
      }
    }

    this.quarries = new Map();
    if (db.quarry) {
      for (const row of db.quarry.iter()) {
        this.quarries.set(row.quarryId, {
          nodeId: row.quarryId,
          kind: 'quarry',
          resource: 'stone',
          remaining: row.remaining,
          maxYield: row.maxYield,
          x: row.x,
          z: row.z,
        });
      }
    }

    this.trees = new Map();
    if (db.tree_entity) {
      for (const row of db.tree_entity.iter()) {
        const phase = normalizeTreePhase(row.phase);
        this.trees.set(row.treeId, {
          treeId: row.treeId,
          layoutIndex: Number(row.layoutIndex),
          phase,
          growthProgress: row.growthProgress,
        });
      }
    }

    this.buildings = new Map();
    if (db.building && this.identityHex) {
      for (const row of db.building.iter()) {
        if (row.owner.toHexString() !== this.identityHex) continue;
        if (!isBuildingKind(row.kind)) continue;
        this.buildings.set(`building-${row.id}`, {
          id: `building-${row.id}`,
          kind: row.kind,
          x: row.x,
          z: row.z,
          workRadius: row.workRadius,
          actionCooldown: row.actionCooldown,
        });
      }
    }

    this.burgageZones = new Map();
    if (db.burgage_zone && this.identityHex) {
      for (const row of db.burgage_zone.iter()) {
        if (row.owner.toHexString() !== this.identityHex) continue;
        this.burgageZones.set(`zone-${row.id}`, {
          id: `zone-${row.id}`,
          cornerA: { x: row.cornerAx, z: row.cornerAz },
          cornerB: { x: row.cornerBx, z: row.cornerBz },
          cornerC: { x: row.cornerCx, z: row.cornerCz },
          cornerD: { x: row.cornerDx, z: row.cornerDz },
          frontageEdge: row.frontageEdge as BurgageFrontageEdge,
          plotCount: Number(row.plotCount),
        });
      }
    }

    this.residences = new Map();
    if (db.residence && this.identityHex) {
      for (const row of db.residence.iter()) {
        if (row.owner.toHexString() !== this.identityHex) continue;
        this.residences.set(`residence-${row.id}`, {
          id: `residence-${row.id}`,
          zoneId: `zone-${row.zoneId}`,
          parcelIndex: Number(row.parcelIndex),
          x: row.x,
          z: row.z,
          yaw: row.yaw,
        });
      }
    }

    this.roads = null;
    if (db.road_network_state && this.identityHex) {
      for (const row of db.road_network_state.iter()) {
        if (row.owner.toHexString() !== this.identityHex) continue;
        try {
          this.roads = JSON.parse(row.snapshotJson) as RoadNetworkSnapshot;
        } catch {
          this.roads = { ...EMPTY_ROAD_SNAPSHOT };
        }
        break;
      }
    }

    this.emit();
  }

  private async callReducer(
    camelName: string,
    snakeName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const connection = getConnection();
    if (!connection) throw new Error('Not connected to SpacetimeDB.');
    const reducers = connection.reducers as unknown as Record<string, ((payload: Record<string, unknown>) => Promise<void>) | undefined>;
    const fn = reducers[camelName] ?? reducers[snakeName];
    if (!fn) {
      throw new Error(`Reducer ${camelName} is missing from generated bindings.`);
    }
    await fn(args);
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

type TableHandle = {
  onInsert: (cb: () => void) => void;
  onUpdate: (cb: () => void) => void;
  onDelete: (cb: () => void) => void;
};

function normalizeTreePhase(value: string): TreePhase {
  if (isTreePhase(value)) return value;
  return 'mature';
}

function inferNextBuildingId(buildings: Map<string, BuildingState>): number {
  let maxId = 0;
  for (const building of buildings.values()) {
    const match = /^building-(\d+)$/.exec(building.id);
    if (!match) continue;
    maxId = Math.max(maxId, Number.parseInt(match[1], 10));
  }
  return maxId + 1;
}

function parseBuildingServerId(buildingId: string): bigint | null {
  const match = /^building-(\d+)$/.exec(buildingId);
  if (!match) return null;
  return BigInt(match[1]);
}

function parseZoneServerId(zoneId: string): bigint | null {
  const match = /^zone-(\d+)$/.exec(zoneId);
  if (!match) return null;
  return BigInt(match[1]);
}
