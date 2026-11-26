import { MAX_IMPORT_FILE_SIZE_BYTES, MAX_IMPORT_FILE_SIZE_MB } from '@gdt/shared'
import type { Context } from 'hono'
import type { Upload } from '../services/import'
import { ApiError } from './http'
import type { ImportStages } from './import-stages'

const tooLarge = () =>
  new ApiError(413, 'too_large', `A GOOD file may be at most ${MAX_IMPORT_FILE_SIZE_MB} MB`)

/**
 * Reads one GOOD file from a request:
 * - multipart/form-data with a `file` part and optional `timestamp` field
 *   (irminsul's contract), the part optionally gzipped (`.gz` / application/gzip);
 * - or a raw application/json body, optionally `Content-Encoding: gzip`, with
 *   `?timestamp=`.
 * The size cap applies to the decompressed text, enforced while streaming.
 * `stages` (the import_stages line) gets the time before and during the read.
 */
export async function readUpload(c: Context, stages?: ImportStages): Promise<Upload> {
  stages?.lap('auth')
  const upload = await readBody(c)
  stages?.lap('body')
  stages?.note({ sent: Number(c.req.header('content-length') ?? 0), raw: upload.rawSize })
  return upload
}

async function readBody(c: Context): Promise<Upload> {
  // Multipart overhead is small; the decompressed check below is authoritative.
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > MAX_IMPORT_FILE_SIZE_BYTES + 64 * 1024) throw tooLarge()

  const type = c.req.header('content-type') ?? ''
  if (type.startsWith('multipart/form-data')) {
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new ApiError(400, 'missing_file', 'Expected a `file` part')
    const gzip = file.type === 'application/gzip' || file.name.endsWith('.gz')
    const timestamp = form.get('timestamp')
    return { ...(await readText(file.stream(), gzip)), timestamp: timestamp ?? undefined }
  }
  if (type.startsWith('application/json') && c.req.raw.body) {
    const gzip = c.req.header('content-encoding') === 'gzip'
    return { ...(await readText(c.req.raw.body, gzip)), timestamp: c.req.query('timestamp') }
  }
  throw new ApiError(415, 'unsupported_media_type', 'Send multipart/form-data or application/json')
}

async function readText(
  stream: ReadableStream<Uint8Array>,
  gzip: boolean,
): Promise<{ text: string; rawSize: number }> {
  const source = gzip ? stream.pipeThrough(new DecompressionStream('gzip')) : stream
  const reader = source.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_IMPORT_FILE_SIZE_BYTES) {
        await reader.cancel()
        throw tooLarge()
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      400,
      'invalid_upload',
      gzip ? 'The file is not valid gzip' : 'Could not read the upload',
    )
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return { text: new TextDecoder().decode(bytes), rawSize: size }
}
