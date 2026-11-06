<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronDown, FileCode, Link2 } from 'lucide-vue-next'
import { FORMAT_NAME } from '@/components/developers/format-name'
import {
  DELTA_ANSWERS,
  DELTA_EXAMPLE,
  DELTA_PATHS,
  FILE_EXAMPLE,
  FILE_LIMITS,
  KEY_DOCS,
  showJson,
} from '@/components/developers/reference'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import LandingNav from '@/components/landing/LandingNav.vue'
import AppearanceControls from '@/components/settings/AppearanceControls.vue'
import UiModal from '@/components/ui/UiModal.vue'
import '@/components/landing/landing.css'
import '@/components/developers/developers.css'

/**
 * The developer page: Leyline, the export format (GOOD + Capture's `gi_*` keys), how
 * a file reaches the tracker, and live sync's delta. Public and dark like the
 * landing page. Its body is English on purpose (lang="en"): it is a technical
 * reference whose field names, paths and codes are English, and translations
 * would drift from the code it describes. Only the frame is translated.
 */
const SECTIONS = [
  { id: 'file', label: 'The file' },
  { id: 'rules', label: 'Rules' },
  { id: 'keys', label: 'Keys' },
  { id: 'upload', label: 'Uploading' },
  { id: 'live', label: 'Live sync' },
] as const

const API = 'https://teyvat.me/api'

const IMPORT_CURL = `curl ${API}/genshin-accounts-public/import-by-key \\
  -H "x-import-key: gdt_ik_…" \\
  -F "file=@export.json"`

const IMPORT_ANSWER = showJson({
  status: 'created',
  snapshotId: 1234,
  takenAt: 1792000000000,
  rawSize: 612345,
  storedSize: 3120,
  account: { id: 12, name: 'Main', uid: '888888888', created: false },
  contentKey: '1a2b3c4d5e',
  live: { base: '1a2b3c4d5e', watching: false },
})

/**
 * Every field typed (public/developers/leyline.d.ts, served as plain text;
 * the same bytes as Capture's docs/leyline.d.ts).
 */
const TYPES_PATH = '/developers/leyline.d.ts'
const TYPES_CURL = `curl -O https://teyvat.me${TYPES_PATH}`

/** A key's anchor: `/developers#gi_tasks` opens that key (README links point here). */
const anchorOf = (key: string) => key.split(', ')[0]!

function openFromHash() {
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
  if (target instanceof HTMLDetailsElement) target.open = true
}
onMounted(() => {
  openFromHash()
  window.addEventListener('hashchange', openFromHash)
})
onBeforeUnmount(() => window.removeEventListener('hashchange', openFromHash))

const languageOpen = ref(false)
</script>

<template>
  <div>
    <div class="lp dev" data-theme="dark">
      <LandingNav
        :links="SECTIONS.map((s) => ({ href: `#${s.id}`, label: s.label }))"
        @language="languageOpen = true"
      />
      <main>
        <section class="sky sec dv-hero" aria-labelledby="dv-title">
          <div class="wrap">
            <div class="sec-h">
              <div class="ov">{{ $t('shell.page.developers') }}</div>
              <h1 id="dv-title" class="h1 dv-name">{{ FORMAT_NAME }}</h1>
              <p class="lead">{{ $t('landing.dev.lead') }}</p>
              <div class="acts dv-acts">
                <a class="btn btn-p" :href="TYPES_PATH" download>
                  <FileCode class="ic" aria-hidden="true" />leyline.d.ts
                </a>
                <code class="dv-curl">{{ TYPES_CURL }}</code>
              </div>
              <p class="muted">{{ $t('landing.dev.english') }}</p>
            </div>
            <nav class="dv-toc" :aria-label="$t('landing.dev.contents')" lang="en">
              <a v-for="s in SECTIONS" :key="s.id" class="chip" :href="`#${s.id}`">{{ s.label }}</a>
            </nav>
          </div>
        </section>

        <div lang="en">
          <section id="file" class="sec band" aria-labelledby="dv-file">
            <div class="wrap dv-split">
              <div class="dv-col">
                <div class="sec-h">
                  <h2 id="dv-file" class="h2">The file</h2>
                  <p class="lead">
                    A GOOD file (version 3) marked <code>"leyline": 1</code>, with optional
                    top-level keys that start with <code>gi_</code>.
                  </p>
                </div>
                <ul class="dv-list">
                  <li>
                    <b><code>"format": "GOOD"</code> stays.</b> Genshin Optimizer and any GOOD
                    reader load the file and skip the keys they don't know.
                  </li>
                  <li>
                    <b><code>leyline</code></b> is the {{ FORMAT_NAME }} version, now 1. The
                    tracker's exports and newer Teyvat.me Capture builds write it. Files from older
                    builds carry the <code>gi_*</code> keys without it and read the same; a file
                    with neither is plain GOOD.
                  </li>
                  <li>
                    <b><code>source</code></b> names the writer: <code>"Teyvat.me"</code>, or
                    <code>"Irminsul"</code> in older captures. Treat it as a label.
                  </li>
                  <li>
                    <b><code>timestamp</code></b> is GOOD's capture time, in unix milliseconds.
                  </li>
                  <li>
                    <b>Characters, weapons and materials</b> use GOOD keys. Ids inside
                    <code>gi_*</code> keys are the game's own; as object keys they are decimal
                    strings.
                  </li>
                </ul>
                <div class="tile-g dv-types">
                  <a class="btn btn-sm btn-g" :href="TYPES_PATH" download>
                    <FileCode class="ic" aria-hidden="true" />leyline.d.ts
                  </a>
                  <span>
                    Every field, typed: the file, the {{ FORMAT_NAME }} delta and the wish sync.
                    <code>{{ TYPES_CURL }}</code>
                  </span>
                </div>
              </div>
              <pre
                class="code dv-col"
                aria-label="Example file"
              ><code>{{ showJson(FILE_EXAMPLE) }}</code></pre>
            </div>
          </section>

          <section id="rules" class="sec" aria-labelledby="dv-rules">
            <div class="wrap">
              <div class="sec-h">
                <h2 id="dv-rules" class="h2">Rules</h2>
              </div>
              <div class="dv-rules">
                <div class="tile-g dv-rule">
                  <b>Only added to</b>
                  <span>Keys and fields are never renamed or removed. New ones are optional.</span>
                </div>
                <div class="tile-g dv-rule">
                  <b>Ignore what you don't know</b>
                  <span>A reader skips unknown keys and fields. The tracker does.</span>
                </div>
                <div class="tile-g dv-rule">
                  <b>Left out, never guessed</b>
                  <span>
                    A value that wasn't captured is absent: never <code>null</code>, never a
                    default. Read an absent number as 0.
                  </span>
                </div>
                <div class="tile-g dv-rule">
                  <b>Unix seconds</b>
                  <span>
                    Every time, except GOOD's <code>timestamp</code> and a live batch's
                    <code>at</code> (milliseconds).
                  </span>
                </div>
                <div class="tile-g dv-rule">
                  <b>Checked on arrival</b>
                  <span>
                    The tracker range-checks every <code>gi_*</code> part. A part that fails is
                    dropped; the rest of the file is kept.
                  </span>
                </div>
              </div>

              <div class="dv-split dv-limits">
                <div class="dv-col">
                  <h3 class="h3">Per file</h3>
                  <p class="muted">
                    Past one of these the file is refused: 422 <code>too_many_items</code> or
                    <code>key_too_long</code>.
                  </p>
                  <div class="dv-table">
                    <table>
                      <tbody>
                        <tr v-for="[what, max] in FILE_LIMITS" :key="what">
                          <th scope="row">{{ what }}</th>
                          <td class="tab">{{ max }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div class="dv-col">
                  <h3 class="h3">Per user</h3>
                  <p class="muted">
                    Only uploads that store something count: an unchanged file costs nothing.
                  </p>
                  <div class="dv-table">
                    <table>
                      <tbody>
                        <tr>
                          <th scope="row">New snapshots a UTC day</th>
                          <td class="tab">1,000</td>
                          <td rowspan="2">
                            <code>429 daily_upload_limit</code>, with <code>Retry-After</code>
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Stored a UTC day</th>
                          <td class="tab">20 MB</td>
                        </tr>
                        <tr>
                          <th scope="row">Stored in all</th>
                          <td class="tab">200 MB</td>
                          <td><code>413 storage_quota</code></td>
                        </tr>
                        <tr>
                          <th scope="row">Uploads a minute, per key or device</th>
                          <td class="tab">20</td>
                          <td><code>429 rate_limited</code></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="keys" class="sec band" aria-labelledby="dv-keys">
            <div class="wrap">
              <div class="sec-h">
                <h2 id="dv-keys" class="h2">Keys</h2>
                <p class="lead">Every one is optional. Examples are made up.</p>
              </div>
              <div class="dv-keys">
                <details
                  v-for="doc in KEY_DOCS"
                  :id="anchorOf(doc.key)"
                  :key="doc.key"
                  class="tile-g dv-key"
                >
                  <summary>
                    <span class="dv-key-h">
                      <code class="dv-key-name">{{ doc.key }}</code>
                      <span v-if="doc.uploadsOnly" class="pill pill-ac">Uploads only</span>
                      <a
                        class="dv-anchor"
                        :href="`#${anchorOf(doc.key)}`"
                        :aria-label="`Link to ${doc.key}`"
                        :title="`#${anchorOf(doc.key)}`"
                        ><Link2 class="ic s" aria-hidden="true"
                      /></a>
                    </span>
                    <span class="dv-key-what">{{ doc.what }}</span>
                    <ChevronDown class="ic" aria-hidden="true" />
                  </summary>
                  <div class="dv-key-b">
                    <pre class="code" aria-label="Shape"><code>{{ doc.shape }}</code></pre>
                    <pre
                      class="code"
                      aria-label="Example"
                    ><code>{{ showJson(doc.example) }}</code></pre>
                    <p v-if="doc.note" class="muted">{{ doc.note }}</p>
                  </div>
                </details>
              </div>
            </div>
          </section>

          <section id="upload" class="sec" aria-labelledby="dv-upload">
            <div class="wrap">
              <div class="sec-h">
                <h2 id="dv-upload" class="h2">Uploading</h2>
                <p class="lead">
                  Three ways in. Each stores a snapshot, or nothing when the file is unchanged.
                </p>
              </div>
              <div class="dv-ways">
                <div class="tile-g dv-way">
                  <h3 class="h3">Import key</h3>
                  <p class="muted">For your own tools.</p>
                  <p>
                    <code>POST /api/genshin-accounts-public/import-by-key</code> with the key in
                    <code>x-import-key</code>. An account's key (<code>gdt_ik_…</code>, on its
                    Import page) uploads to that account. The all-accounts key
                    (<code>gdt_uk_…</code>, Settings) uploads to the account whose UID is
                    <code>gi_player.uid</code>, making it on the first upload; without a UID, 422
                    <code>uid_required</code>.
                  </p>
                  <p>
                    Body: <code>multipart/form-data</code> with a <code>file</code> (gzip allowed as
                    <code>.gz</code>) and an optional <code>timestamp</code>; or the JSON itself as
                    <code>application/json</code> (<code>Content-Encoding: gzip</code> allowed,
                    <code>?timestamp=</code>). <code>GET …/verify-key</code> checks a key.
                  </p>
                  <pre class="code"><code>{{ IMPORT_CURL }}</code></pre>
                </div>
                <div class="tile-g dv-way">
                  <h3 class="h3">Sign-in</h3>
                  <p class="muted">Teyvat.me Capture.</p>
                  <p>
                    OAuth 2.0 authorization code with PKCE (S256) and a loopback redirect; the
                    client is Capture's own, found at <code>GET /api/oauth/irminsul</code>. With its
                    token, <code>POST /api/irminsul/import</code> and
                    <code>Authorization: Bearer …</code> take the same body and give the same
                    answers as an import key. Where a signed-in PC's uploads go is set on the
                    website, in Settings → Devices.
                  </p>
                </div>
                <div class="tile-g dv-way">
                  <h3 class="h3">The website</h3>
                  <p class="muted">By hand.</p>
                  <p>
                    An account's Import page takes {{ FORMAT_NAME }} and GOOD files, many at once.
                  </p>
                </div>
              </div>
              <div class="dv-split dv-answer">
                <div class="dv-col">
                  <h3 class="h3">The answer</h3>
                  <p>
                    <code>201</code> when a snapshot was stored, <code>200</code> with
                    <code>status: "unchanged"</code> when the file matched the newest one.
                    <code>warnings</code> appear when there is something to say, for example
                    <code>uid_changed</code>. <code>account</code> says where an import key's upload
                    went. <code>live</code> is there only when live sync is on for the account.
                  </p>
                  <p class="muted">
                    Answers only gain fields. An error is
                    <code>{ "error": { "code", "message" } }</code>, the code such as
                    <code>too_many_items</code>.
                  </p>
                </div>
                <pre
                  class="code dv-col"
                  aria-label="Example answer"
                ><code>{{ IMPORT_ANSWER }}</code></pre>
              </div>
            </div>
          </section>

          <section id="live" class="sec band" aria-labelledby="dv-live">
            <div class="wrap">
              <div class="sec-h">
                <h2 id="dv-live" class="h2">Live sync</h2>
                <p class="lead">
                  Between snapshots, Capture sends small batches of changes: the
                  {{ FORMAT_NAME }} delta. On the wire its <code>format</code> is
                  <code>"GOOD-X-delta"</code>.
                </p>
              </div>
              <ol class="dv-steps">
                <li>
                  Upload a snapshot with <code>gi_capture</code>, and <code>gi_guid</code> on every
                  weapon and artifact.
                </li>
                <li>
                  If the answer has <code>live.base</code>, send batches for that base from
                  <code>seq</code> 1 to <code>POST /api/irminsul/changes</code> (Bearer or
                  <code>x-import-key</code>).
                </li>
                <li>Without <code>live</code>, keep to snapshots.</li>
              </ol>
              <div class="dv-split">
                <div class="dv-col">
                  <ul class="dv-list">
                    <li>At most 2,000 changes and 512 KB a batch.</li>
                    <li>
                      Each change is <code>["set", path, value]</code>,
                      <code>["add", path, whole]</code> or <code>["del", path]</code>, with an
                      absolute value, so applying one twice is harmless. Unknown paths are ignored.
                    </li>
                    <li>
                      <code>base</code> must be the journal's base, <code>session</code> the
                      snapshot's <code>gi_capture.session</code>, <code>seq</code> the last + 1; an
                      older <code>seq</code> is a duplicate.
                    </li>
                    <li>
                      <code>sum</code> (optional): the whole account's counts after the batch —
                      characters, weapons, artifacts, materials, mora, primogem, and unlocked,
                      unequipped 3★ and 4★ artifacts (<code>artifact3</code>,
                      <code>artifact4</code>).
                    </li>
                  </ul>
                </div>
                <pre
                  class="code dv-col"
                  aria-label="Example batch"
                ><code>{{ showJson(DELTA_EXAMPLE) }}</code></pre>
              </div>
              <div class="dv-split dv-limits">
                <div class="dv-col">
                  <h3 class="h3">Paths</h3>
                  <div class="dv-table">
                    <table>
                      <tbody>
                        <tr v-for="[path, value] in DELTA_PATHS" :key="path">
                          <th scope="row">
                            <code>{{ path }}</code>
                          </th>
                          <td>{{ value }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div class="dv-col">
                  <h3 class="h3">Answers</h3>
                  <div class="dv-table">
                    <table>
                      <tbody>
                        <tr v-for="[answer, then] in DELTA_ANSWERS" :key="answer">
                          <th scope="row">
                            <code>{{ answer }}</code>
                          </th>
                          <td>{{ then }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>
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
