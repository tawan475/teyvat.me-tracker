import { watchEffect } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { pageTitle } from '@/components/shell/nav'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { useAccounts } from '@/stores/accounts'
import { canonicalUrl } from './public-pages'

/**
 * Every page's tab title, description and link-preview tags (the user's rule,
 * docs/plans/open-site.md §1: every route, public or private): "Planner ·
 * Teyvat.me", "Characters · <account> · Teyvat.me" on an account's pages, the
 * page's own `shell.description` sentence, og:title / og:description to match
 * and a canonical link on the pages search engines index. Kept current on a
 * page change, a language switch and an account rename.
 */
export interface DocumentMeta {
  title: string
  description: string
  canonical: string | null
}

export function documentMeta(route: RouteLocationNormalizedLoaded): DocumentMeta {
  const { meta } = route
  const canonical = canonicalUrl(route.path)
  if (!meta.title) {
    // The landing page (the only page without a title of its own).
    return {
      title: t('shell.landingTitle'),
      description: t('shell.description.landing'),
      canonical,
    }
  }
  const page = pageTitle(meta)
  const description = meta.inspect
    ? t('shell.description.inspect')
    : t(`shell.description.${meta.title}`)
  const account = meta.inspect ? null : accountName(route)
  const title = account
    ? t('shell.accountDocumentTitle', { title: page, account })
    : t('shell.documentTitle', { title: page })
  return { title, description, canonical }
}

/**
 * The signed-in user's account the page is about ("a/:accountId"), by its
 * shown name; on the public demo's pages, "Demo".
 */
function accountName(route: RouteLocationNormalizedLoaded): string | null {
  if (route.meta.demo) return t('demo.account')
  const id = Number(route.params.accountId)
  if (!Number.isInteger(id) || id <= 0) return null
  const accounts = useAccounts()
  const account = accounts.byId.get(id)
  return account ? accounts.displayName(account) : null
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attribute, key)
    document.head.appendChild(tag)
  }
  if (tag.content !== content) tag.content = content
}

function setCanonical(href: string | null) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!href) {
    link?.remove()
    return
  }
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  if (link.href !== href) link.href = href
}

export function applyDocumentMeta(meta: DocumentMeta) {
  if (document.title !== meta.title) document.title = meta.title
  setMeta('name', 'description', meta.description)
  setMeta('property', 'og:title', meta.title)
  setMeta('property', 'og:description', meta.description)
  setCanonical(meta.canonical)
}

let installed = false
/** Starts keeping the document's head in step (after Pinia is installed: the first navigation). */
export function installDocumentMeta(router: Router) {
  if (installed) return
  installed = true
  watchEffect(() => {
    void locale.value
    applyDocumentMeta(documentMeta(router.currentRoute.value))
  })
}
