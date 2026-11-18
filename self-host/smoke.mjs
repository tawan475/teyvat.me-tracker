// The self-host smoke test's HTTP checks (.github/workflows/self-host.yml runs
// them against a container started from self-host/compose.yml). Node 24 and
// its built-ins only: nothing to install.
//
//   node self-host/smoke.mjs <phase>
//
// Phases, in the workflow's order (state between them in SMOKE_STATE):
//   health     the private health tier answers with the env file's DIAG_KEY
//   register   signs player01 up, makes a Genshin account
//   check      Owner given (by the workflow, grant-owner), uploads and reads
//              back, a forged Host never reaches an address, live updates,
//              live sync into gdt-live
//   restarted  after a restart: the data is still there
//
// Settings (environment): SMOKE_BASE (default http://localhost:8787, where
// the container listens), SITE_URL (what self-host/.env says), DIAG_KEY,
// SMOKE_STATE (a JSON file). Examples are made up: player01, UID 812345678.

import { request } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = new URL(process.env.SMOKE_BASE || 'http://localhost:8787')
const SITE = new URL(process.env.SITE_URL || 'http://localhost:8787').origin
const DIAG_KEY = process.env.DIAG_KEY || ''
const STATE_FILE = process.env.SMOKE_STATE || 'smoke-state.json'
const USERNAME = 'player01'
const PASSWORD = 'smoke test password 0123456789'
const UID = 812345678
const FORGED = 'evil.example'

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}
function ok(condition, message) {
  if (!condition) fail(message)
  console.log(`ok - ${message}`)
}

const state = (() => {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
})()
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

/** One request with any headers (Host included, which fetch won't set). */
function call(method, path, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: BASE.hostname,
        port: BASE.port || 80,
        method,
        path,
        headers: { host: host ?? BASE.host, ...headers },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json
          try {
            json = JSON.parse(text)
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json })
        })
      },
    )
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** A browser stand-in on SITE_URL: cookies, the CSRF header and its Origin. */
class Browser {
  cookies = new Map()
  async fetch(method, path, { json, headers = {}, host, form } = {}) {
    const all = { 'x-gdt-csrf': '1', origin: SITE, ...headers }
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    if (cookie) all.cookie = cookie
    let body
    if (json !== undefined) {
      all['content-type'] = 'application/json'
      body = JSON.stringify(json)
    } else if (form) {
      all['content-type'] = form.type
      body = form.body
    }
    const res = await call(method, path, { headers: all, body, host })
    for (const line of [res.headers['set-cookie'] ?? []].flat()) {
      const [pair] = line.split(';')
      const at = pair.indexOf('=')
      const name = pair.slice(0, at).trim()
      const value = pair.slice(at + 1).trim()
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return res
  }
}

async function signIn() {
  const browser = new Browser()
  const res = await browser.fetch('POST', '/api/auth/login', {
    json: { login: USERNAME, password: PASSWORD },
  })
  if (res.status !== 200) fail(`sign in: ${res.status} ${res.text}`)
  return browser
}

/** A small made-up GOOD file, as Capture sends it (guids + gi_capture for live sync). */
function sampleGood(timestamp) {
  const top = BigInt(UID) << 32n
  const guid = (n) => (top + BigInt(n)).toString()
  return {
    format: 'GOOD',
    version: 3,
    source: 'Irminsul',
    characters: [
      {
        key: 'Furina',
        level: 90,
        constellation: 2,
        ascension: 6,
        talent: { auto: 6, skill: 10, burst: 10 },
      },
      {
        key: 'Bennett',
        level: 80,
        constellation: 6,
        ascension: 6,
        talent: { auto: 1, skill: 9, burst: 12 },
      },
    ],
    artifacts: [
      {
        setKey: 'GoldenTroupe',
        slotKey: 'flower',
        level: 20,
        rarity: 5,
        mainStatKey: 'hp',
        location: 'Furina',
        lock: true,
        totalRolls: 9,
        astralMark: false,
        elixirCrafted: false,
        substats: [
          { key: 'critRate_', value: 10.5, initialValue: 3.9 },
          { key: 'critDMG_', value: 21.8, initialValue: 7.8 },
        ],
        unactivatedSubstats: [],
        gi_guid: guid(100),
      },
    ],
    weapons: [
      {
        key: 'SplendorOfTranquilWaters',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Furina',
        lock: true,
        gi_guid: guid(500),
      },
    ],
    materials: { Mora: 1_000_000, Primogem: 16_000 },
    gi_player: { uid: UID, ar: 60, arExp: 0, wl: 8, wlLimit: 9, resin: 124, maxStamina: 24000 },
    gi_capture: {
      v: 1,
      reason: 'login',
      session: 'SMOKE0SESSION001',
      world: 1,
      journal: { seq: 0 },
    },
    timestamp,
  }
}

function multipart(good, timestamp) {
  const boundary = `----smoke${randomBytes(8).toString('hex')}`
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n${timestamp}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="capture.json"\r\n` +
    `Content-Type: application/json\r\n\r\n${JSON.stringify(good)}\r\n--${boundary}--\r\n`
  return { type: `multipart/form-data; boundary=${boundary}`, body }
}

/** Opens /api/live as `browser` and resolves with the first event matching `want`. */
function liveSocket(browser) {
  return new Promise((resolve, reject) => {
    const events = []
    const waiters = []
    const req = request({
      host: BASE.hostname,
      port: BASE.port || 80,
      path: '/api/live',
      headers: {
        host: BASE.host,
        connection: 'Upgrade',
        upgrade: 'websocket',
        origin: SITE,
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        cookie: [...browser.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
    })
    req.on('response', (res) => reject(new Error(`/api/live answered ${res.statusCode}`)))
    req.on('error', reject)
    req.on('upgrade', (_res, socket, head) => {
      let buffer = Buffer.alloc(0)
      const read = (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        // Server frames are unmasked; text frames only matter here.
        while (buffer.length >= 2) {
          let length = buffer[1] & 0x7f
          let offset = 2
          if (length === 126) {
            if (buffer.length < 4) return
            length = buffer.readUInt16BE(2)
            offset = 4
          } else if (length === 127) {
            if (buffer.length < 10) return
            length = Number(buffer.readBigUInt64BE(2))
            offset = 10
          }
          if (buffer.length < offset + length) return
          const opcode = buffer[0] & 0x0f
          const payload = buffer.subarray(offset, offset + length)
          buffer = buffer.subarray(offset + length)
          if (opcode !== 1) continue
          const event = JSON.parse(payload.toString('utf8'))
          events.push(event)
          for (const waiter of waiters.splice(0)) waiter()
        }
      }
      // The first frames can come with the 101 answer.
      read(head)
      socket.on('data', read)
      resolve({
        async next(want, timeoutMs = 15_000) {
          const deadline = Date.now() + timeoutMs
          for (;;) {
            const found = events.find(want)
            if (found) return found
            if (Date.now() > deadline) throw new Error('no live event in time')
            await new Promise((done) => {
              waiters.push(done)
              setTimeout(done, 500)
            })
          }
        },
        close: () => socket.destroy(),
      })
    })
    req.end()
  })
}

/** No address in an answer may name the forged host or teyvat.me: all on SITE_URL. */
function onSite(label, url) {
  ok(typeof url === 'string' && new URL(url).origin === SITE, `${label} is on SITE_URL (${url})`)
}

const phases = {
  async health() {
    const res = await call('GET', '/api/health', { headers: { 'x-diag-key': DIAG_KEY } })
    ok(res.status === 200 && res.json?.status === 'ok', `health ok (${res.status})`)
    ok(res.json?.schema?.pending?.length === 0, 'no pending migrations')
    ok(res.json?.diagnostics?.via === 'diag-key', "the env file's DIAG_KEY opens the private tier")
  },

  async register() {
    const browser = new Browser()
    const res = await browser.fetch('POST', '/api/auth/register', {
      json: { username: USERNAME, password: PASSWORD },
    })
    ok(
      res.status === 200 || res.status === 201,
      `player01 signed up (${res.status} ${res.text.slice(0, 200)})`,
    )
    const staff = await browser.fetch('GET', '/api/staff/me')
    ok(staff.status === 404, 'not staff before grant-owner')
    const created = await browser.fetch('POST', '/api/accounts', {
      json: { name: 'Main', uid: String(UID), server: 'ASIA' },
    })
    ok(created.status === 201, `account created (${created.status})`)
    state.accountId = created.json.account.id
    state.importKey = created.json.importKey
    saveState()
  },

  async check() {
    const browser = await signIn()
    const staff = await browser.fetch('GET', '/api/staff/me')
    ok(
      staff.status === 200 && staff.json.permissions.includes('*'),
      'grant-owner made player01 Owner',
    )

    // Upload (as Capture does, by import key) with a live socket open.
    const socket = await liveSocket(browser)
    await socket.next((e) => e.type === 'hello')
    ok(true, '/api/live opened (the Durable Object answers)')
    const timestamp = Date.now() - 60_000
    const form = multipart(sampleGood(timestamp), timestamp)
    const upload = await call('POST', '/api/genshin-accounts-public/import-by-key', {
      headers: { 'x-import-key': state.importKey, 'content-type': form.type },
      body: form.body,
    })
    ok(upload.status < 300, `upload by import key (${upload.status} ${upload.text.slice(0, 200)})`)
    const base = upload.json?.live?.base
    ok(typeof base === 'string', 'the upload opened a live journal')
    const event = await socket.next((e) => e.type === 'data' && e.accountId === state.accountId)
    ok(Boolean(event), 'the live event for the upload arrived')

    const list = await browser.fetch('GET', `/api/accounts/${state.accountId}/snapshots`)
    ok(list.status === 200 && list.json.length === 1, 'one snapshot listed')
    state.snapshotId = list.json[0].id
    saveState()
    const good = await browser.fetch(
      'GET',
      `/api/accounts/${state.accountId}/snapshots/${state.snapshotId}/good`,
    )
    ok(good.status === 200 && good.json.characters?.length === 2, 'the snapshot reads back as GOOD')
    ok(good.json.materials?.Mora === 1_000_000, 'with its materials')

    // Live sync: one batch into gdt-live, read back.
    const batch = {
      format: 'GOOD-X-delta',
      v: 1,
      uid: UID,
      session: 'SMOKE0SESSION001',
      seq: 1,
      base,
      at: Date.now(),
      changes: [['set', ['materials', 'Mora'], 1_000_500]],
    }
    const sent = await call('POST', '/api/irminsul/changes', {
      headers: { 'x-import-key': state.importKey, 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
    ok(
      sent.status === 200 && sent.json?.ok === true,
      `live batch stored (${sent.status} ${sent.text.slice(0, 200)})`,
    )
    await socket.next((e) => e.type === 'live' && e.accountId === state.accountId)
    ok(true, 'the live batch event arrived')
    const journal = await browser.fetch('GET', `/api/accounts/${state.accountId}/live`)
    ok(
      journal.status === 200 && journal.json.open && journal.json.seq === 1,
      'the journal reads back from gdt-live',
    )
    socket.close()

    // A forged Host and X-Forwarded-Host never reach an address.
    const forged = { 'x-forwarded-host': FORGED, 'x-forwarded-proto': 'https' }
    const discovery = await call('GET', '/api/oauth/irminsul', { host: FORGED, headers: forged })
    ok(discovery.status === 200, 'discovery answers')
    for (const key of ['authorize_url', 'token_url', 'revoke_url']) onSite(key, discovery.json[key])

    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const redirect = 'http://127.0.0.1:53682/callback'
    const authorized = await browser.fetch('POST', '/api/oauth/authorize', {
      host: FORGED,
      headers: forged,
      json: {
        client_id: 'irminsul',
        redirect_uri: redirect,
        state: 'smoke-state-0123456789abcdefghijklmnop',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        device: 'SMOKE-PC',
        upload: { mode: 'uid' },
      },
    })
    ok(
      authorized.status === 200,
      `authorize (${authorized.status} ${authorized.text.slice(0, 200)})`,
    )
    const code = new URL(authorized.json.redirect).searchParams.get('code')
    const token = await call('POST', '/api/oauth/token', {
      host: FORGED,
      headers: { ...forged, 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: 'irminsul',
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
      }),
    })
    ok(token.status === 200, `token exchange (${token.status})`)
    const whoami = await call('GET', '/api/irminsul/whoami', {
      host: FORGED,
      headers: { ...forged, authorization: `Bearer ${token.json.access_token}` },
    })
    ok(whoami.status === 200, 'whoami answers')
    onSite('configUrl', whoami.json.configUrl)
    for (const text of [discovery.text, whoami.text]) {
      ok(
        !text.includes(FORGED) && !text.includes('teyvat.me'),
        'no forged host or teyvat.me in the answer',
      )
    }

    // Passkeys: the relying party is SITE_URL's host.
    const providers = await call('GET', '/api/auth/oauth/providers', {
      host: FORGED,
      headers: forged,
    })
    const passkeysExpected = SITE.startsWith('https:') || new URL(SITE).hostname === 'localhost'
    ok(
      providers.json?.passkeys === passkeysExpected,
      `passkeys ${passkeysExpected ? 'on' : 'off'} for ${SITE}`,
    )
  },

  async restarted() {
    const browser = await signIn()
    const list = await browser.fetch('GET', `/api/accounts/${state.accountId}/snapshots`)
    ok(list.status === 200 && list.json.length === 1, 'the snapshot survived the restart')
    const good = await browser.fetch(
      'GET',
      `/api/accounts/${state.accountId}/snapshots/${state.snapshotId}/good`,
    )
    ok(good.status === 200 && good.json.materials?.Mora === 1_000_000, 'and reads back')
  },
}

const phase = process.argv[2]
if (!phases[phase]) fail(`usage: node self-host/smoke.mjs ${Object.keys(phases).join('|')}`)
await phases[phase]()
console.log(`phase ${phase}: passed`)
