<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, Send } from 'lucide-vue-next'
import { API_GUIDE, type GuideBlock } from '@/data/api-guide'
import reference from '@/data/api-reference.json'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import LandingNav from '@/components/landing/LandingNav.vue'
import AppearanceControls from '@/components/settings/AppearanceControls.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { copyText } from '@/data/import-setup'
import '@/components/landing/landing.css'

/**
 * /developers/api (docs/plans/public-api.md §9, design A): three columns,
 * the contents on the left, the guide and each endpoint in the middle, its
 * examples in a dark rail on the right. Built from the same sources as
 * /developers/api.md: the guide (src/data/api-guide.ts) and the OpenAPI the
 * route registry generates (src/data/api-reference.json, `pnpm api:docs`).
 * English body, like /developers; only the frame is translated.
 */

interface Operation {
  operationId: string
  tags: string[]
  summary: string
  description?: string
  parameters?: {
    name: string
    in: string
    required?: boolean
    schema?: { type?: string; description?: string }
  }[]
  requestBody?: { content: Record<string, { schema?: unknown; example?: unknown }> }
  responses: Record<
    string,
    { description?: string; content?: Record<string, { example?: unknown }> }
  >
}
interface Endpoint {
  method: string
  path: string
  op: Operation
}

const doc = reference as unknown as {
  tags: { name: string }[]
  paths: Record<string, Record<string, Operation>>
}

const endpoints: Endpoint[] = Object.entries(doc.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({ method: method.toUpperCase(), path, op })),
)
const groups = doc.tags.map((tag) => ({
  name: tag.name,
  id: `r-${tag.name.toLowerCase().replace(/\s+/g, '-')}`,
  endpoints: endpoints.filter((e) => e.op.tags[0] === tag.name),
}))

const METHOD_CLASS: Record<string, string> = {
  GET: 'border-accent-text/55 text-accent-text',
  POST: 'border-transparent bg-accent text-white',
  PUT: 'border-transparent bg-accent text-white',
  PATCH: 'border-dashed border-warning-text/60 text-warning-text',
  DELETE: 'border-danger-border bg-danger-surface text-danger-text',
}

/** `code` spans in guide text; everything else is plain text (no HTML). */
function pieces(text: string): { code: boolean; text: string }[] {
  return text
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1
        ? { code: true, text: part.slice(1, -1) }
        : { code: false, text: part },
    )
}
const isText = (b: GuideBlock): b is { text: string } => 'text' in b

/** Scope and bucket from the operation's description ("Scope: …. Bucket `x`: …."). */
function facts(op: Operation) {
  const text = op.description ?? ''
  const scope = /Scope: ([^.]+)\./.exec(text)?.[1] ?? ''
  const bucket = /Bucket `([^`]+)`: ([^.]+)\./.exec(text)
  const body = text.replace(/\n\nScope: .*$/s, '').trim()
  return { scope, bucket: bucket?.[1] ?? '', limit: bucket?.[2] ?? '', body }
}

function curl(e: Endpoint): string {
  const path = e.path.replace('{id}', '12').replace(/\{\w+\}/g, '1')
  const lines = [
    `curl${e.method === 'GET' ? '' : ` -X ${e.method}`} "https://teyvat.me/api/v1${path}"`,
  ]
  if (!(e.op as { security?: unknown[] }).security)
    lines.push('  -H "Authorization: Bearer $TEYVAT_TOKEN"')
  const example = e.op.requestBody?.content['application/json']?.example
  if (example !== undefined) {
    lines.push('  -H "Content-Type: application/json"')
    lines.push(`  -d '${JSON.stringify(example)}'`)
  } else if (e.op.requestBody)
    lines.push('  -H "Content-Type: application/json" --data-binary @file.json')
  return lines.join(' \\\n')
}

function exampleAnswer(e: Endpoint): string | null {
  for (const [status, answer] of Object.entries(e.op.responses)) {
    const example = answer.content?.['application/json']?.example
    if (example !== undefined && status.startsWith('2')) return JSON.stringify(example, null, 2)
  }
  return null
}

const okStatus = (e: Endpoint) =>
  Object.keys(e.op.responses).find((s) => s.startsWith('2')) ?? '200'

// ------------------------------------------------------------------ Try it

const tryValues = ref<Record<string, Record<string, string>>>({})
const tryResult = ref<Record<string, { status: number; body: string } | 'busy'>>({})
const canTry = (e: Endpoint) => e.method === 'GET'

async function send(e: Endpoint) {
  const values = tryValues.value[e.op.operationId] ?? {}
  let path = e.path
  for (const p of e.op.parameters ?? []) {
    if (p.in !== 'path') continue
    path = path.replace(`{${p.name}}`, encodeURIComponent(values[p.name] ?? ''))
  }
  tryResult.value = { ...tryResult.value, [e.op.operationId]: 'busy' }
  try {
    const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin' })
    const text = await response.text()
    let body = text
    try {
      body = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      /* not JSON */
    }
    tryResult.value = { ...tryResult.value, [e.op.operationId]: { status: response.status, body } }
  } catch (error) {
    tryResult.value = {
      ...tryResult.value,
      [e.op.operationId]: {
        status: 0,
        body: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
function setValue(id: string, name: string, value: string) {
  tryValues.value = { ...tryValues.value, [id]: { ...tryValues.value[id], [name]: value } }
}

const copied = ref<string | null>(null)
async function copy(key: string, text: string) {
  if (await copyText(text)) {
    copied.value = key
    setTimeout(() => (copied.value = copied.value === key ? null : copied.value), 1500)
  }
}

const languageOpen = ref(false)
const navLinks = computed(() => [
  { href: '/developers', label: 'Upload format' },
  { href: '#getting-started', label: 'API' },
  { href: '/developers/api.md', label: 'api.md' },
])
</script>

<template>
  <div>
    <div class="lp dev" data-theme="dark">
      <LandingNav :links="navLinks" @language="languageOpen = true" />
      <main lang="en" class="text-text-primary">
        <div
          class="mx-auto grid w-full max-w-[1600px] grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)]"
        >
          <nav
            aria-label="Contents"
            class="hidden border-r border-border-default px-3 py-6 lg:block"
          >
            <div
              class="sticky top-4 flex max-h-[calc(100dvh-2rem)] flex-col gap-0.5 overflow-y-auto"
            >
              <p
                class="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-text-muted uppercase"
              >
                Start
              </p>
              <a
                v-for="s in API_GUIDE"
                :key="s.id"
                :href="`#${s.id}`"
                class="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-overlay/60 hover:text-text-primary"
                >{{ s.title }}</a
              >
              <p
                class="px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-text-muted uppercase"
              >
                Resources
              </p>
              <a
                v-for="g in groups"
                :key="g.id"
                :href="`#${g.id}`"
                class="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-overlay/60 hover:text-text-primary"
                >{{ g.name }}</a
              >
            </div>
          </nav>

          <div class="flex min-w-0 flex-col">
            <header class="px-6 pt-10 pb-6 lg:px-11">
              <p class="text-xs font-semibold tracking-wide text-text-muted uppercase">
                Developers
              </p>
              <h1 class="mt-2 text-4xl font-bold tracking-tight">Teyvat.me API</h1>
              <p class="mt-3 max-w-3xl text-text-secondary">
                Your accounts, snapshots, wishes and plans, as JSON. One token, the same rules
                everywhere.
              </p>
              <div class="mt-5 flex flex-wrap gap-3 text-sm">
                <a
                  class="rounded-lg bg-accent px-4 py-2 font-medium text-white"
                  href="/app/settings#api-tokens"
                  >Get a token</a
                >
                <a
                  class="rounded-lg border border-border-strong px-4 py-2"
                  href="/developers/api.md"
                  >api.md</a
                >
                <a
                  class="rounded-lg border border-border-strong px-4 py-2"
                  href="/api/v1/openapi.json"
                  >openapi.json</a
                >
              </div>
            </header>

            <section
              v-for="s in API_GUIDE"
              :id="s.id"
              :key="s.id"
              class="scroll-mt-4 border-t border-border-default px-6 py-8 lg:px-11"
            >
              <h2 class="text-2xl font-bold">{{ s.title }}</h2>
              <div class="mt-4 flex max-w-4xl flex-col gap-4 text-text-secondary">
                <template v-for="(b, i) in s.blocks" :key="i">
                  <p v-if="isText(b)">
                    <template v-for="(p, j) in pieces(b.text)" :key="j"
                      ><code
                        v-if="p.code"
                        class="rounded bg-surface-overlay px-1 font-mono text-[0.85em] text-text-primary"
                        >{{ p.text }}</code
                      ><template v-else>{{ p.text }}</template></template
                    >
                  </p>
                  <pre
                    v-else-if="'code' in b"
                    class="overflow-x-auto rounded-lg border border-border-default bg-[#0b1222] px-4 py-3 font-mono text-[0.8rem] leading-relaxed text-text-secondary"
                  ><code>{{ b.code }}</code></pre>
                  <ul v-else-if="'list' in b" class="flex list-disc flex-col gap-1.5 pl-5">
                    <li v-for="(item, j) in b.list" :key="j">
                      <template v-for="(p, k) in pieces(item)" :key="k"
                        ><code
                          v-if="p.code"
                          class="rounded bg-surface-overlay px-1 font-mono text-[0.85em] text-text-primary"
                          >{{ p.text }}</code
                        ><template v-else>{{ p.text }}</template></template
                      >
                    </li>
                  </ul>
                  <div v-else class="overflow-x-auto rounded-xl border border-border-default">
                    <table class="w-full text-sm">
                      <thead class="bg-surface-raised text-left text-text-muted">
                        <tr>
                          <th
                            v-for="h in b.table.head"
                            :key="h"
                            scope="col"
                            class="px-3 py-2 font-medium"
                          >
                            {{ h }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(row, j) in b.table.rows"
                          :key="j"
                          class="border-t border-border-subtle"
                        >
                          <td v-for="(cell, k) in row" :key="k" class="px-3 py-2 align-top">
                            <template v-for="(p, m) in pieces(cell)" :key="m"
                              ><code
                                v-if="p.code"
                                class="font-mono text-[0.85em] text-text-primary"
                                >{{ p.text }}</code
                              ><template v-else>{{ p.text }}</template></template
                            >
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </template>
              </div>
            </section>

            <section
              v-for="g in groups"
              :id="g.id"
              :key="g.id"
              class="scroll-mt-4 border-t border-border-default"
            >
              <h2 class="px-6 pt-8 text-2xl font-bold lg:px-11">{{ g.name }}</h2>
              <article
                v-for="e in g.endpoints"
                :id="e.op.operationId"
                :key="e.op.operationId"
                class="grid scroll-mt-4 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]"
              >
                <div class="flex min-w-0 flex-col gap-3 px-6 py-7 lg:px-11">
                  <div class="flex flex-wrap items-center gap-2.5">
                    <span
                      class="inline-flex h-6 min-w-14 items-center justify-center rounded border px-1.5 font-mono text-xs font-bold"
                      :class="METHOD_CLASS[e.method]"
                      >{{ e.method }}</span
                    >
                    <code class="font-mono text-sm break-all">/api/v1{{ e.path }}</code>
                  </div>
                  <h3 class="text-lg font-semibold">{{ e.op.summary }}</h3>
                  <p v-if="facts(e.op).body" class="text-text-secondary">
                    <template v-for="(p, j) in pieces(facts(e.op).body)" :key="j"
                      ><code
                        v-if="p.code"
                        class="rounded bg-surface-overlay px-1 font-mono text-[0.85em] text-text-primary"
                        >{{ p.text }}</code
                      ><template v-else>{{ p.text }}</template></template
                    >
                  </p>
                  <div class="flex flex-wrap gap-2 text-xs">
                    <span
                      class="rounded border border-accent-text/40 px-1.5 py-0.5 text-accent-text"
                      title="Token scope"
                      >{{ facts(e.op).scope }}</span
                    >
                    <a
                      class="rounded border border-border-strong px-1.5 py-0.5 text-text-secondary"
                      href="#rate-limits"
                      :title="`Bucket ${facts(e.op).bucket}: ${facts(e.op).limit}`"
                      >Bucket {{ facts(e.op).bucket }} · {{ facts(e.op).limit }}</a
                    >
                  </div>
                  <div
                    v-if="e.op.parameters?.length"
                    class="overflow-x-auto rounded-xl border border-border-default"
                  >
                    <table class="w-full text-sm">
                      <thead class="bg-surface-raised text-left text-text-muted">
                        <tr>
                          <th scope="col" class="px-3 py-2 font-medium">Parameter</th>
                          <th scope="col" class="px-3 py-2 font-medium">In</th>
                          <th scope="col" class="px-3 py-2 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="p in e.op.parameters"
                          :key="p.in + p.name"
                          class="border-t border-border-subtle"
                        >
                          <td class="px-3 py-2">
                            <code class="font-mono">{{ p.name }}</code>
                            <span v-if="p.required" class="ml-1 text-xs text-text-muted"
                              >required</span
                            >
                          </td>
                          <td class="px-3 py-2 text-text-muted">{{ p.in }}</td>
                          <td class="px-3 py-2 text-text-secondary">
                            {{ p.schema?.description ?? p.schema?.type ?? '' }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div
                    v-if="canTry(e)"
                    class="flex flex-col gap-2 rounded-xl border border-border-default bg-surface-raised p-4"
                  >
                    <div class="flex flex-wrap items-end gap-3">
                      <label
                        v-for="p in (e.op.parameters ?? []).filter((x) => x.in === 'path')"
                        :key="p.name"
                        class="flex flex-col gap-1 text-sm"
                      >
                        <span class="text-text-secondary">{{ p.name }}</span>
                        <input
                          class="min-h-9 w-32 rounded-md border border-border-default bg-surface-base px-2 font-mono text-sm"
                          :value="tryValues[e.op.operationId]?.[p.name] ?? ''"
                          @input="
                            setValue(
                              e.op.operationId,
                              p.name,
                              ($event.target as HTMLInputElement).value,
                            )
                          "
                        />
                      </label>
                      <button
                        type="button"
                        class="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white disabled:opacity-50"
                        :disabled="tryResult[e.op.operationId] === 'busy'"
                        @click="send(e)"
                      >
                        <Send class="size-4" aria-hidden="true" />Try it
                      </button>
                      <span
                        class="text-xs text-text-muted"
                        title="Calls the API with this browser's sign-in"
                        >As you, when signed in</span
                      >
                    </div>
                    <pre
                      v-if="tryResult[e.op.operationId] && tryResult[e.op.operationId] !== 'busy'"
                      class="max-h-80 overflow-auto rounded-lg border border-border-default bg-[#0b1222] px-4 py-3 font-mono text-[0.78rem] text-text-secondary"
                    ><code>{{ (tryResult[e.op.operationId] as { status: number }).status }}
{{ (tryResult[e.op.operationId] as { body: string }).body }}</code></pre>
                  </div>
                </div>
                <aside
                  aria-label="Examples"
                  class="flex min-w-0 flex-col gap-4 border-border-default bg-[#0b1222] px-6 py-7 xl:border-l"
                >
                  <div class="overflow-hidden rounded-lg border border-border-default">
                    <div
                      class="flex items-center justify-between border-b border-border-default px-3 py-1.5"
                    >
                      <span class="text-xs text-text-muted">curl</span>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                        @click="copy(e.op.operationId, curl(e))"
                      >
                        <Copy class="size-3.5" aria-hidden="true" />{{
                          copied === e.op.operationId ? 'Copied' : 'Copy'
                        }}
                      </button>
                    </div>
                    <pre
                      class="overflow-x-auto px-4 py-3 font-mono text-[0.78rem] leading-relaxed text-text-secondary"
                    ><code>{{ curl(e) }}</code></pre>
                  </div>
                  <div
                    v-if="exampleAnswer(e)"
                    class="overflow-hidden rounded-lg border border-border-default"
                  >
                    <div class="border-b border-border-default px-3 py-1.5 text-xs text-text-muted">
                      {{ okStatus(e) }} · application/json
                    </div>
                    <pre
                      class="max-h-96 overflow-auto px-4 py-3 font-mono text-[0.78rem] leading-relaxed text-text-secondary"
                    ><code>{{ exampleAnswer(e) }}</code></pre>
                  </div>
                </aside>
              </article>
            </section>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
    <UiModal
      :open="languageOpen"
      :title="$t('settings.appearance.language')"
      @close="languageOpen = false"
    >
      <AppearanceControls language-only />
    </UiModal>
  </div>
</template>
