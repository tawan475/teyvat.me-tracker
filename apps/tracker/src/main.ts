// First: drops fbclid / utm_* from the address before the router reads it.
import './lib/strip-tracking'
import './assets/main.css'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { i18n } from './i18n'
// Registers its preload before the first language applies (game names in Chinese).
import './i18n/game-names'
import { applyLocale, resolveLocale, storedPreference, warnMissingKeys } from './i18n/apply'
import { registerServiceWorker } from './pwa/register'
import { watchImageLoading } from './lib/image-loading'
import router from './router'

watchImageLoading()
const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
warnMissingKeys()

// Another language's messages and game names load before the first paint (a
// few KB, cached by the service worker), so nothing shows in English first;
// English after 3 s at worst. English mounts at once (its messages are built
// in). The account's own setting applies when the session loads.
const preference = storedPreference()
const loading = applyLocale(preference).catch(() => undefined)
const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000))
// A prerendered page (build/prerender.ts) on screen stays until its route is
// ready, rather than going blank while the page's code and session load.
const root = document.getElementById('app')
const prerendered =
  root?.hasAttribute('data-prerendered') === true &&
  !document.documentElement.hasAttribute('data-prerender-hide')
void (resolveLocale(preference) === 'en' ? Promise.resolve() : Promise.race([loading, timeout]))
  .then(() => (prerendered ? router.isReady().catch(() => undefined) : undefined))
  .then(() => {
    root?.removeAttribute('data-prerendered')
    app.mount('#app')
  })

registerServiceWorker()
