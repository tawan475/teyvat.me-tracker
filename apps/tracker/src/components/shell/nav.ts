import type { PermissionNode } from '@gdt/shared'
import type { RouteMeta } from 'vue-router'
import {
  Castle,
  ClipboardList,
  Gem,
  HardDrive,
  History,
  LayoutDashboard,
  Library,
  Package,
  ScrollText,
  Shield,
  Sparkles,
  Swords,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-vue-next'
import { t, type MessageSchema } from '@/i18n'

/** A sidebar label: a key of the `shell.nav` messages. */
export type NavKey = keyof MessageSchema['shell']['nav']
/** A page title: a key of the `shell.page` messages (route `meta.title`). */
export type PageKey = keyof MessageSchema['shell']['page']

/** A route's title in the language on screen ("Inspect · Characters" under Inspect). */
export function pageTitle(meta: RouteMeta): string {
  if (!meta.title) return ''
  const page = t(`shell.page.${meta.title}`)
  return meta.inspect ? t('shell.page.inspect', { page }) : page
}

export interface AccountSection {
  name: string
  /** The label's message (`shell.nav.<label>`). */
  label: NavKey
  icon: LucideIcon
  /** Staff: shown in the mobile tab bar (the rest live under "More"); accounts use `settings.tabBar`. */
  primary?: boolean
}

/** The sections of one Genshin account, in navigation order. */
export const ACCOUNT_SECTIONS: AccountSection[] = [
  { name: 'account-overview', label: 'overview', icon: LayoutDashboard, primary: true },
  { name: 'account-characters', label: 'characters', icon: Users, primary: true },
  { name: 'account-artifacts', label: 'artifacts', icon: Gem },
  { name: 'account-weapons', label: 'weapons', icon: Swords },
  { name: 'account-materials', label: 'materials', icon: Package, primary: true },
  { name: 'account-planner', label: 'planner', icon: ClipboardList, primary: true },
  { name: 'account-collections', label: 'collections', icon: Library },
  { name: 'account-endgame', label: 'endgame', icon: Castle },
  { name: 'account-wishes', label: 'wishes', icon: Sparkles },
  { name: 'account-snapshots', label: 'snapshots', icon: History },
  { name: 'account-settings', label: 'manage', icon: UserCog },
]

/** Pages without a nav entry of their own, lit as the section they open from. */
export const NAV_PARENT: Readonly<Record<string, string>> = {}

export interface StaffSection extends AccountSection {
  /** The node the page needs (the Worker checks it again). */
  permission: PermissionNode
}

/** The staff dashboard's pages, shown to whoever holds their node. */
export const STAFF_SECTIONS: StaffSection[] = [
  {
    name: 'staff-overview',
    label: 'staffOverview',
    icon: LayoutDashboard,
    permission: 'staff.view',
    primary: true,
  },
  { name: 'staff-users', label: 'users', icon: Users, permission: 'users.view', primary: true },
  {
    name: 'staff-storage',
    label: 'storage',
    icon: HardDrive,
    permission: 'data.storage',
    primary: true,
  },
  { name: 'staff-roles', label: 'roles', icon: Shield, permission: 'roles.manage' },
  { name: 'staff-audit', label: 'audit', icon: ScrollText, permission: 'audit.view' },
]
