declare module 'mux.js' {
  type Segment = { initSegment: Uint8Array; data: Uint8Array; type: string };
  class Transmuxer {
    constructor(options?: { remux?: boolean });
    on(event: 'data', listener: (segment: Segment) => void): void;
    push(segment: Uint8Array): void;
    flush(): void;
    dispose(): void;
  }
  const muxjs: { mp4: { Transmuxer: typeof Transmuxer } };
  export default muxjs;
}
