import { partOfSwitch, type OffSwitch, type RemovablePart } from '@gdt/shared'
import { t } from '@/i18n'

/** A removable part's name (`snapshots.parts.names.<part>`). */
export function partLabel(part: RemovablePart): string {
  return t(`snapshots.parts.names.${part}`)
}

/** The builds and the account numbers: switches that are not removable parts. */
const OTHER_NAMES = {
  characters: 'characters',
  weapons: 'weapons',
  artifacts: 'artifacts',
  materials: 'materials',
  'gi_player.numbers': 'numbers',
} as const

/** A Capture switch's name, as its Sharing page shows it. */
export function switchLabel(name: OffSwitch): string {
  const part = partOfSwitch(name)
  if (part) return partLabel(part)
  return t(`snapshots.parts.names.${OTHER_NAMES[name as keyof typeof OTHER_NAMES]}`)
}
