declare module 'three/examples/jsm/loaders/GLTFLoader' {
  import { Group } from 'three';

  export interface GLTF {
    scene: Group;
    scenes: Group[];
    animations: any[];
  }

  export class GLTFLoader {
    constructor();
    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: ErrorEvent) => void
    ): void;
    // minimal parse signature
    parse(buffer: ArrayBuffer, path: string, onLoad: (gltf: GLTF) => void, onError?: (err: Error) => void): void;
  }

  export default GLTFLoader;
}
