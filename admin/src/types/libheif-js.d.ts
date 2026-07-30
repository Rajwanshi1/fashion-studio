/**
 * libheif-js publishes emscripten bindings with no types for the wasm subpath.
 * Declare just the high-level decoder surface the intake pipeline uses.
 */
declare module 'libheif-js/wasm-bundle' {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      done: (result: { data: Uint8ClampedArray } | null) => void,
    ): void;
  }

  interface HeifDecoder {
    decode(buffer: Uint8Array): HeifImage[];
  }

  const libheif: { HeifDecoder: new () => HeifDecoder };
  export default libheif;
}
