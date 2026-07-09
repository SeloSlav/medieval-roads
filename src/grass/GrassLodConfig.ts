/** Shared fade distances for grass mesh opacity and terrain colour LOD (world units). */
export const GRASS_LOD = {
  /** Full instanced grass + detailed terrain texture. */
  near: 38,
  /** No instanced grass + simplified far terrain grass colour. */
  far: 92,
} as const;
