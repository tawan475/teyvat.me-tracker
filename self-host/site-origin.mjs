// SITE_URL's origin, as a self-host may use it; else why not, and exit 1.
// Run by self-host/Dockerfile (the origin the image is built for) and by
// start.sh (the origin self-host/.env names):
//
//   node self-host/site-origin.mjs <SITE_URL>
//
// Plain http works only on this machine: the sign-in cookies are Secure, and
// browsers keep Secure cookies over http on localhost alone (passkeys and push
// need https there too). Anything else goes behind a proxy with TLS.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

const value = (process.argv[2] ?? '').trim()
let url
try {
  url = new URL(value)
} catch {
  url = null
}
if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
  console.error(`SITE_URL is not an http(s) address: "${value}"`)
  process.exit(1)
}
if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) {
  console.error(
    `SITE_URL is ${url.origin}: plain http works only on localhost (browsers drop ` +
      'the sign-in cookies anywhere else); put a proxy with TLS in front and use ' +
      'https:// (self-host/README.md)',
  )
  process.exit(1)
}
console.log(url.origin)
