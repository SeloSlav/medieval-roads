import * as THREE from 'three';

export type BitmapTextureOptions = {
  srgb?: boolean;
  anisotropyLimit?: number;
  wrapping?: THREE.Wrapping;
  generateMipmaps?: boolean;
  flipY?: boolean;
};

const textureLoader = new THREE.TextureLoader();

export async function loadBitmapTexture(
  url: string,
  maxAnisotropy: number,
  options?: BitmapTextureOptions,
): Promise<THREE.Texture> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Texture fetch failed (${response.status}): ${url}`);
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const texture = new THREE.Texture(bitmap);
    texture.wrapS = options?.wrapping ?? THREE.RepeatWrapping;
    texture.wrapT = options?.wrapping ?? THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = options?.generateMipmaps ?? true;
    if (options?.flipY != null) texture.flipY = options.flipY;
    const limit = options?.anisotropyLimit ?? 16;
    texture.anisotropy = Math.max(1, Math.min(limit, maxAnisotropy));
    if (options?.srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  } catch (error) {
    console.warn('Bitmap texture decode failed; falling back to TextureLoader.', url, error);
    const texture = await textureLoader.loadAsync(url);
    texture.wrapS = options?.wrapping ?? THREE.RepeatWrapping;
    texture.wrapT = options?.wrapping ?? THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = options?.generateMipmaps ?? true;
    if (options?.flipY != null) texture.flipY = options.flipY;
    const limit = options?.anisotropyLimit ?? 16;
    texture.anisotropy = Math.max(1, Math.min(limit, maxAnisotropy));
    if (options?.srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
}
