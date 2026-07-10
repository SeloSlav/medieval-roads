import * as THREE from 'three';

export type RoadEdge = {
  id: string;
  startNodeId: string;
  endNodeId: string;
  controlPoints: THREE.Vector3[];
  width: number;
  sampledPath: THREE.Vector3[];
  length: number;
  mesh?: THREE.Group;
  materialData?: {
    surface: 'medieval_dirt';
    bridgeSpans?: Array<{
      rampStart: number;
      deckStart: number;
      deckEnd: number;
      rampEnd: number;
      deckY: number;
    }>;
  };
  editableState: 'normal' | 'selected' | 'preview';
  revision: number;
};
