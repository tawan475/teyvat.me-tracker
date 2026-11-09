/** Types of inflate.mjs (the raw download's script). */
export interface InflateIo {
  read(path: string): Uint8Array
  write(path: string, bytes: Uint8Array): void
}
export function inflateAll(
  io: InflateIo,
  inflateRaw: (bytes: Uint8Array, dictionary?: Uint8Array) => Uint8Array,
): { sections: number; catalog: number; bytesIn: number; bytesOut: number }
