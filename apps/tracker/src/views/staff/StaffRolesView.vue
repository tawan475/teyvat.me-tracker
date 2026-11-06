<script setup lang="ts">
import {
  PERMISSION_GROUPS,
  ROLE_COLORS,
  hasPermission,
  type StaffRole,
  type StaffUserRow,
} from '@gdt/shared'
import { refDebounced } from '@vueuse/core'
import { computed, ref, shallowRef, watch } from 'vue'
import { GripVertical, Lock, Plus, Search, X } from 'lucide-vue-next'
import { useDragOrder } from '@/components/planner/use-drag-order'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiError from '@/components/ui/UiError.vue'
import UiField from '@/components/ui/UiField.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import SectionLabel from '@/components/shell/SectionLabel.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t, te } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { useFeedback } from '@/stores/feedback'
import { useStaff } from '@/stores/staff'

/**
 * Roles, Discord-style: the list is the hierarchy (drag the ones below yours
 * to reorder); a role's name, colour, permissions and members on the right.
 * Owner is locked (the command line gives it); you change only roles below
 * your own, and grant or take away only permissions you have.
 */
const feedback = useFeedback()
const staffStore = useStaff()
const { data, error, reload } = useResource(
  () => true,
  () => api.staff.roles(),
)

const roles = computed<StaffRole[]>(() => data.value?.roles ?? [])
const selectedId = ref<number | null>(null)
watch(
  roles,
  (list) => {
    if (!list.some((r) => r.id === selectedId.value)) {
      selectedId.value = (list.find((r) => r.editable) ?? list[0])?.id ?? null
    }
  },
  { immediate: true },
)
const selected = computed(() => roles.value.find((r) => r.id === selectedId.value) ?? null)
const grantable = computed(() => data.value?.grantable ?? [])
const canGrant = (node: string) => hasPermission(grantable.value, node as never)

// --------------------------------------------------------------------- editor

const name = ref('')
const color = ref<string>(ROLE_COLORS[0])
const nodes = shallowRef<ReadonlySet<string>>(new Set())

function resetDraft() {
  const role = selected.value
  name.value = role?.name ?? ''
  color.value = role?.color ?? ROLE_COLORS[0]
  nodes.value = new Set(role?.permissions ?? [])
}
watch(selected, resetDraft, { immediate: true })

const locked = computed(() => !selected.value?.editable)
const isOwner = computed(() => selected.value?.builtIn === true)
const nodeOn = (node: string) => isOwner.value || nodes.value.has(node)
function setNode(node: string, on: boolean) {
  const next = new Set(nodes.value)
  if (on) next.add(node)
  else next.delete(node)
  nodes.value = next
}

const dirty = computed(() => {
  const role = selected.value
  if (!role || locked.value) return false
  const before = new Set(role.permissions)
  return (
    name.value.trim() !== role.name ||
    color.value !== role.color ||
    before.size !== nodes.value.size ||
    [...nodes.value].some((n) => !before.has(n))
  )
})
const nodeCount = computed(() =>
  isOwner.value
    ? PERMISSION_GROUPS.reduce((n, g) => n + g.nodes.length, 0)
    : (selected.value?.permissions.length ?? 0),
)

const busy = ref(false)
async function run(
  work: () => Promise<unknown>,
  done: string,
  failed = t('staff.common.notSaved'),
) {
  busy.value = true
  try {
    await work()
    if (done) feedback.toast({ tone: 'success', title: done })
    await reload()
    void staffStore.reload()
  } catch (cause) {
    feedback.error(failed, cause)
  } finally {
    busy.value = false
  }
}

function save() {
  const role = selected.value
  if (!role || !dirty.value) return
  void run(
    () =>
      api.staff.updateRole(role.id, {
        name: name.value.trim(),
        color: color.value,
        permissions: [...nodes.value],
      }),
    t('staff.roles.saved', { name: name.value.trim() }),
  )
}

async function createRole() {
  busy.value = true
  try {
    const role = await api.staff.createRole({
      name: t('staff.roles.newRole'),
      color: ROLE_COLORS[ROLE_COLORS.length - 1]!,
      permissions: [],
    })
    await reload()
    selectedId.value = role.id
  } catch (cause) {
    feedback.error(t('staff.roles.notCreated'), cause)
  } finally {
    busy.value = false
  }
}

async function deleteRole() {
  const role = selected.value
  if (!role) return
  const ok = await feedback.confirm({
    title: t('staff.roles.deleteTitle', { name: role.name }),
    detail: t(
      'staff.roles.deleteDetail',
      { n: formatNumber(role.members.length) },
      role.members.length,
    ),
    confirmLabel: t('staff.roles.deleteRole'),
    tone: 'danger',
  })
  if (ok) {
    await run(
      () => api.staff.deleteRole(role.id),
      t('staff.roles.deleted', { name: role.name }),
      t('staff.common.notDeleted'),
    )
  }
}

/** A permission group's name and a node's label in the language on screen (the shared table is English). */
const groupLabel = (name: string) => {
  const key = `staff.permissions.groups.${name.toLowerCase()}`
  return te(key, 'en') ? t(key) : name
}
const nodeLabel = (node: string, fallback: string) => {
  const key = `staff.permissions.nodes.${node.replace(/[._](\w)/g, (_, c: string) => c.toUpperCase())}`
  return te(key, 'en') ? t(key) : fallback
}

// ------------------------------------------------------------------- ordering

/** Optimistic order while a reorder saves. */
const order = shallowRef<number[] | null>(null)
const shown = computed(() => {
  const list = roles.value
  if (!order.value) return list
  const rank = new Map(order.value.map((id, i) => [id, i]))
  const fixed = list.filter((r) => !r.editable)
  const movable = list.filter((r) => r.editable).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return [...fixed, ...movable]
})

function reorder(ids: number[]) {
  order.value = ids
  void run(() => api.staff.orderRoles(ids), '', t('staff.roles.orderNotSaved')).finally(
    () => (order.value = null),
  )
}

function movableIds(): number[] {
  return shown.value.filter((r) => r.editable).map((r) => r.id)
}

const drag = useDragOrder({
  move(id, to) {
    const ids = movableIds()
    const from = ids.indexOf(Number(id.slice(5)))
    const target = ids.indexOf(Number(to.slice(5)))
    if (from < 0 || target < 0) return
    const [moved] = ids.splice(from, 1)
    ids.splice(target, 0, moved!)
    reorder(ids)
  },
  step(id, delta) {
    const ids = movableIds()
    const from = ids.indexOf(Number(id.slice(5)))
    if (from < 0) return
    const target =
      delta === 'start' ? 0 : delta === 'end' ? ids.length - 1 : from + (delta as number)
    if (target < 0 || target >= ids.length || target === from) return
    const [moved] = ids.splice(from, 1)
    ids.splice(target, 0, moved!)
    reorder(ids)
  },
})

// -------------------------------------------------------------------- members

const addAnchor = ref<HTMLElement | null>(null)
const adding = ref(false)
const search = ref('')
const query = refDebounced(search, 250)
const results = ref<StaffUserRow[]>([])
watch([query, adding], async ([q, open]) => {
  if (!open || !q.trim()) {
    results.value = []
    return
  }
  try {
    results.value = (await api.staff.users({ q: q.trim() })).users.slice(0, 8)
  } catch {
    results.value = []
  }
})

function addMember(user: StaffUserRow) {
  const role = selected.value
  if (!role) return
  adding.value = false
  search.value = ''
  void run(
    () => api.staff.addRole(user.id, role.id),
    t('staff.roles.memberAdded', { user: user.username, role: role.name }),
  )
}

function removeMember(member: { id: number; username: string }) {
  const role = selected.value
  if (!role) return
  void run(
    () => api.staff.removeRole(member.id, role.id),
    t('staff.roles.memberRemoved', { user: member.username, role: role.name }),
  )
}
</script>

<template>
  <PageHeader :title="$t('staff.roles.title')" />

  <UiError
    v-if="error && !data"
    :error="error"
    :title="$t('staff.roles.couldNotLoad')"
    @retry="reload"
  />

  <div v-else-if="!data" class="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]" aria-busy="true">
    <UiSkeleton class="h-72" />
    <UiSkeleton class="h-[32rem]" />
  </div>

  <div v-else class="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
    <UiPanel :title="$t('staff.roles.title')" flush>
      <template #actions>
        <UiButton size="sm" :disabled="busy" @click="createRole">
          <Plus class="size-4" aria-hidden="true" />
          {{ $t('staff.roles.newRole') }}
        </UiButton>
      </template>
      <ul class="flex flex-col p-2" :aria-label="$t('staff.roles.listLabel')">
        <li
          v-for="role in shown"
          :key="role.id"
          :data-goal-card="role.editable ? `role:${role.id}` : undefined"
          class="flex items-center rounded-md"
          :class="
            drag.over.value === `role:${role.id}` && drag.dragging.value !== `role:${role.id}`
              ? 'ring-2 ring-accent'
              : ''
          "
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2.5 text-left text-[0.9375rem] font-medium transition-colors"
            :class="
              role.id === selectedId
                ? 'bg-surface-overlay text-text-primary'
                : 'text-text-secondary hover:bg-surface-overlay/60 hover:text-text-primary'
            "
            :aria-current="role.id === selectedId ? 'true' : undefined"
            :title="role.builtIn ? $t('staff.roles.ownerTitle') : role.name"
            @click="selectedId = role.id"
          >
            <span
              v-if="role.editable"
              :data-goal-handle="`role:${role.id}`"
              class="-my-1 flex cursor-grab touch-none items-center rounded text-text-muted focus-visible:outline-2 focus-visible:outline-focus-ring"
              role="button"
              tabindex="0"
              :aria-label="$t('staff.roles.move', { name: role.name })"
              :title="$t('staff.roles.dragHint')"
              @pointerdown.stop="drag.start(`role:${role.id}`, $event)"
              @click.stop
              @keydown="drag.key(`role:${role.id}`, $event)"
            >
              <GripVertical class="size-4" aria-hidden="true" />
            </span>
            <span v-else class="w-4" aria-hidden="true" />
            <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: role.color }" />
            <span class="min-w-0 flex-1 truncate">{{ role.name }}</span>
            <Lock
              v-if="!role.editable"
              class="size-3.5 shrink-0 text-text-muted"
              :aria-label="role.builtIn ? $t('staff.roles.locked') : $t('staff.roles.aboveYours')"
            />
            <UiBadge mono>{{ formatNumber(role.members.length) }}</UiBadge>
          </button>
        </li>
      </ul>
      <p
        class="px-5 pb-4 text-[0.8125rem] text-text-muted"
        :title="$t('staff.roles.hierarchyTitle')"
      >
        {{ $t('staff.roles.hierarchy') }}
      </p>
    </UiPanel>

    <UiPanel v-if="selected" flush>
      <template #header>
        <h2 class="flex min-w-0 items-center gap-2 text-base font-semibold">
          <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: color }" />
          <span class="truncate">{{ selected.name }}</span>
        </h2>
        <span class="tabular text-sm text-text-muted">{{
          $t('staff.roles.permissionCount', { n: formatNumber(nodeCount) })
        }}</span>
      </template>

      <div class="flex flex-col gap-6 p-5">
        <p
          v-if="isOwner"
          class="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
          role="note"
        >
          <Lock class="size-4 shrink-0" aria-hidden="true" />
          {{ $t('staff.roles.ownerNote') }}
        </p>
        <p
          v-else-if="locked"
          class="flex items-center gap-2 rounded-xl border border-border-default bg-surface-overlay px-4 py-3 text-sm text-text-secondary"
          role="note"
        >
          <Lock class="size-4 shrink-0" aria-hidden="true" />
          {{ $t('staff.roles.lockedNote') }}
        </p>

        <div class="flex flex-wrap gap-x-6 gap-y-4">
          <UiField v-slot="{ id }" :label="$t('staff.roles.name')" class="min-w-0 flex-[1_1_15rem]">
            <UiInput :id="id" v-model="name" maxlength="32" :disabled="locked" />
          </UiField>
          <div class="flex flex-col gap-1">
            <span class="text-sm font-medium text-text-secondary">{{
              $t('staff.roles.colour')
            }}</span>
            <div class="flex gap-1.5" role="radiogroup" :aria-label="$t('staff.roles.colour')">
              <button
                v-for="swatch in ROLE_COLORS"
                :key="swatch"
                type="button"
                role="radio"
                class="size-10 rounded-md border-2 transition-colors disabled:cursor-not-allowed"
                :class="color === swatch ? 'border-text-primary' : 'border-transparent'"
                :style="{ backgroundColor: swatch }"
                :aria-checked="color === swatch"
                :aria-label="swatch"
                :disabled="locked"
                @click="color = swatch"
              />
            </div>
          </div>
        </div>

        <section v-for="group in PERMISSION_GROUPS" :key="group.name">
          <SectionLabel :label="groupLabel(group.name)" />
          <div class="divide-y divide-border-subtle">
            <UiSwitch
              v-for="p in group.nodes"
              :key="p.node"
              :model-value="nodeOn(p.node)"
              :label="nodeLabel(p.node, p.label)"
              :description="p.node"
              :disabled="locked || !canGrant(p.node)"
              :title="!locked && !canGrant(p.node) ? $t('staff.roles.noPermission') : undefined"
              @update:model-value="(on: boolean) => setNode(p.node, on)"
            />
          </div>
        </section>

        <section>
          <SectionLabel :label="$t('staff.roles.members')" />
          <div class="flex flex-wrap items-center gap-2 pt-1">
            <span
              v-for="member in selected.members"
              :key="member.id"
              class="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border-default bg-surface-raised py-1 pr-1 pl-1.5 text-sm font-medium"
            >
              <RouterLink
                :to="{ name: 'staff-user', params: { userId: member.id } }"
                class="hover:text-accent-text"
                >{{ member.username }}</RouterLink
              >
              <button
                v-if="!locked"
                type="button"
                class="inline-flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-overlay hover:text-text-primary"
                :aria-label="$t('staff.roles.remove', { name: member.username })"
                :title="$t('staff.roles.remove', { name: member.username })"
                :disabled="busy"
                @click="removeMember(member)"
              >
                <X class="size-4" aria-hidden="true" />
              </button>
            </span>
            <span v-if="!locked" ref="addAnchor" class="inline-flex">
              <UiButton variant="ghost" size="sm" @click="adding = !adding">
                <Plus class="size-4" aria-hidden="true" />
                {{ $t('staff.roles.addMember') }}
              </UiButton>
              <UiPopover
                :open="adding"
                :anchor="addAnchor"
                :label="$t('staff.roles.addMember')"
                @close="adding = false"
              >
                <div class="flex flex-col gap-2 p-3">
                  <label class="relative">
                    <span class="sr-only">{{ $t('staff.roles.searchUsers') }}</span>
                    <Search
                      class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
                      aria-hidden="true"
                    />
                    <UiInput
                      v-model="search"
                      type="search"
                      class="pl-9"
                      :placeholder="$t('staff.roles.memberPlaceholder')"
                      autofocus
                    />
                  </label>
                  <button
                    v-for="user in results"
                    :key="user.id"
                    type="button"
                    class="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium hover:bg-surface-overlay"
                    @click="addMember(user)"
                  >
                    {{ user.username }}
                    <span class="tabular font-mono text-xs text-text-muted">#{{ user.id }}</span>
                  </button>
                </div>
              </UiPopover>
            </span>
          </div>
        </section>
      </div>

      <div
        v-if="!locked"
        class="flex flex-wrap items-center justify-between gap-2 border-t border-border-default bg-surface-overlay/40 px-5 py-3"
      >
        <UiButton variant="ghost" class="text-danger-text!" :disabled="busy" @click="deleteRole">
          {{ $t('staff.roles.deleteRole') }}
        </UiButton>
        <span class="flex gap-2">
          <UiButton :disabled="!dirty || busy" @click="resetDraft">{{
            $t('staff.roles.discard')
          }}</UiButton>
          <UiButton
            variant="primary"
            :disabled="!dirty || !name.trim()"
            :loading="busy"
            @click="save"
          >
            {{ $t('staff.common.save') }}
          </UiButton>
        </span>
      </div>
    </UiPanel>
  </div>
</template>
