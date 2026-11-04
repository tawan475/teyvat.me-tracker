import { describe, expect, it } from 'vitest'
import html from '../../../index.html?raw'
import { LANGUAGE_FONTS } from '@/lib/language-fonts'
import { browserLanguages, detectLocale, LOCALES } from '../locale'

/**
 * index.html picks the language before the app loads, in its own copy of the
 * rules (no imports there). It must answer like `detectLocale`.
 */
const script =
  /\/\/ Language before first paint[\s\S]*?\n(\s*;\(function \(\) \{[\s\S]*?\}\)\(\))/.exec(
    html,
  )?.[1]

function firstPaint(
  languages: readonly string[] | undefined,
  language = '',
  stored: string | null = null,
) {
  const root = { lang: '' }
  const run = new Function('localStorage', 'navigator', 'document', script!)
  run({ getItem: () => stored }, { languages, language }, { documentElement: root })
  return root.lang
}

const TAGS: string[][] = [
  ['ja-JP', 'en-US'],
  ['ko'],
  ['pt-BR'],
  ['es-419', 'en'],
  ['th-TH'],
  ['de_DE'],
  ['nl-NL', 'fr-FR'],
  ['en-GB', 'ru-RU'],
  ['zh-CN'],
  ['zh'],
  ['zh-TW'],
  ['zh-HK'],
  ['zh-MO'],
  ['zh-SG'],
  ['zh-Hant-SG'],
  ['zh-Hans-HK'],
  ['zh_Hant'],
  ['yue'],
  ['yue-Hans-CN'],
  ['in-ID'],
  ['nl', 'pl'],
  [],
]

describe('the first-paint language script', () => {
  it('is in index.html', () => {
    expect(script).toBeTruthy()
  })

  it('lists the same languages', () => {
    const list = /var ours = (\[[^\]]*\])/.exec(script!)?.[1]
    expect(JSON.parse(list!.replace(/'/g, '"'))).toEqual([...LOCALES])
  })

  it('names the same web fonts as lib/language-fonts', () => {
    const table = /var fonts = (\{[^}]*\})/.exec(script!)?.[1]
    expect(new Function(`return ${table}`)()).toEqual(LANGUAGE_FONTS)
  })

  it('adds the language font link at first paint', () => {
    const links: { href: string; attrs: Record<string, string> }[] = []
    const doc = {
      documentElement: { lang: '' },
      createElement: () => {
        const link = { href: '', attrs: {} as Record<string, string> }
        return Object.assign(link, {
          setAttribute: (k: string, v: string) => (link.attrs[k] = v),
        })
      },
      head: { appendChild: (link: (typeof links)[number]) => links.push(link) },
    }
    const run = new Function('localStorage', 'navigator', 'document', script!)
    run({ getItem: () => 'th' }, { languages: ['en'] }, doc)
    expect(links.map((l) => l.href)).toEqual([
      'https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap',
    ])
    expect(links[0]!.attrs['data-language-font']).toBe('th')
    links.length = 0
    run({ getItem: () => 'ja' }, { languages: ['en'] }, doc)
    expect(links).toEqual([])
  })

  it('answers like detectLocale', () => {
    for (const tags of TAGS) expect(firstPaint(tags), tags.join(',')).toBe(detectLocale(tags))
  })

  it('reads navigator.language where the list is missing', () => {
    expect(firstPaint(undefined, 'ja-JP')).toBe('ja')
    expect(firstPaint([], 'ko-KR')).toBe('ko')
    expect(detectLocale(browserLanguages({ languages: [], language: 'ko-KR' }))).toBe('ko')
  })

  it("keeps this device's pick", () => {
    expect(firstPaint(['ja'], '', 'vi')).toBe('vi')
    expect(firstPaint(['ja'], '', 'xx')).toBe('ja')
  })
})
