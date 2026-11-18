<script setup lang="ts">
import {
  ALL_PARTS_NOTE,
  PART_SWITCH,
  REMOVABLE_PARTS,
  type RemovablePart,
  type SnapshotResponse,
} from '@gdt/shared'
import { computed, ref } from 'vue'
import { EyeOff, Trash2, X } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { loadSnapshots } from '@/data/account-data'
import { allPartsNote, offSince, partNote } from '@/data/not-shared'
import { hidePartNote, usePartNotes } from '@/data/part-notes'
import { useResource } from '@/data/use-resource'
import { useFeedback } from '@/stores/feedback'
import { t } from '@/i18n'
import { formatMonthDay } from '@/lib/format'
import { useAccess, useAccount, useAccountMode, useTravel } from '@/views/account/context'
import RemovePartDialog from './RemovePartDialog.vue'
import { partLabel, switchLabel } from './part-names'

/**
 * "Not shared by Capture" (issue 12, item 3; the user's pick: D's strip):
 * a slim dashed strip on top of a part's page when Teyvat.me Capture's newest
 * upload says the part was left out (`gi_off`), and "Removed from history"
 * once the owner removed it. The page keeps showing the last capture that had
 * it. Everyone who sees the account sees the strip (staff Inspect too); the
 * owner (and the guest) also gets "Remove from history…" and × (hides it
 * until the part is shared again). `all`: Overview's, naming every part left out.
 */
const props = defineProps<{
  parts?: readonly RemovablePart[]
  all?: boolean
  /** When the capture the page shows was taken ("showing the capture of …"). */
  shownAt?: number | null
}>()

const account = useAccount()
const mode = useAccountMode()
const access = useAccess()
const travel = useTravel()
const feedback = useFeedback()

// The past shows the capture as it was: no notes about now.
const list = useResource(
  () => (travel.value ? null : account.value),
  (a) => (a ? loadSnapshots(a) : Promise.resolve([] as SnapshotResponse[])),
)
const snapshots = computed(() => list.data.value ?? [])
const notes = usePartNotes(() => account.value.id)
const canAct = computed(
  () => access.value === 'owner' && !mode.readOnly && !mode.demo && !travel.value,
)

const partNotes = computed(() =>
  props.all || !list.data.value || !notes.value
    ? []
    : (props.parts ?? []).flatMap((part) => {
        const note = partNote(part, snapshots.value, notes.value)
        return note ? [note] : []
      }),
)
const overview = computed(() =>
  props.all && list.data.value && notes.value ? allPartsNote(snapshots.value, notes.value) : null,
)

/** The parts Capture leaves out now (the dialog lists them first). */
const notShared = computed(() =>
  REMOVABLE_PARTS.filter((part) => offSince(snapshots.value, PART_SWITCH[part]) !== null),
)

const dialogOpen = ref(false)
async function hide(key: RemovablePart | typeof ALL_PARTS_NOTE) {
  try {
    await hidePartNote(account.value.id, key)
  } catch (cause) {
    feedback.error(t('snapshots.parts.hideFailed'), cause)
  }
}
</script>

<template>
  <div v-if="partNotes.length || overview" class="mb-4 flex flex-col gap-2">
    <div v-if="overview" class="strip" role="status">
      <EyeOff class="size-4 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-[1_1_16rem]">
        <b>{{ $t('snapshots.parts.notShared') }}</b>
        {{
          $t('snapshots.parts.sinceList', {
            date: formatMonthDay(overview.since),
            parts: overview.names.map(switchLabel).join(', '),
          })
        }}
      </span>
      <span v-if="canAct" class="ml-auto flex items-center gap-1.5">
        <UiButton variant="ghost" size="sm" @click="dialogOpen = true">
          <Trash2 class="size-4" aria-hidden="true" />
          {{ $t('snapshots.parts.remove') }}
        </UiButton>
        <UiIconButton
          :label="$t('snapshots.parts.hide')"
          :title="$t('snapshots.parts.hideAll')"
          @click="hide(ALL_PARTS_NOTE)"
        >
          <X class="size-4" aria-hidden="true" />
        </UiIconButton>
      </span>
    </div>

    <div v-for="note in partNotes" :key="note.part" class="strip" role="status">
      <template v-if="note.removedAt !== null">
        <Trash2 class="size-4 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-[1_1_16rem]">
          <b>{{ $t('snapshots.parts.removed') }}</b>
          {{ $t('snapshots.parts.removedOn', { date: formatMonthDay(note.removedAt) }) }}
          <template v-if="note.since !== null">
            ·
            {{ $t('snapshots.parts.alsoNotShared', { date: formatMonthDay(note.since) }) }}
          </template>
        </span>
      </template>
      <template v-else>
        <EyeOff class="size-4 shrink-0" aria-hidden="true" />
        <span
          class="min-w-0 flex-[1_1_16rem]"
          :title="
            $t('snapshots.parts.tip', {
              part: partLabel(note.part),
              date: formatMonthDay(note.since!),
            })
          "
        >
          <b>{{ $t('snapshots.parts.notShared') }}</b>
          {{ $t('snapshots.parts.since', { date: formatMonthDay(note.since!) }) }}
          <template v-if="shownAt">
            ·
            {{ $t('snapshots.parts.showing', { date: formatMonthDay(shownAt) }) }}
          </template>
        </span>
      </template>
      <span v-if="canAct" class="ml-auto flex items-center gap-1.5">
        <UiButton
          v-if="note.removedAt === null"
          variant="ghost"
          size="sm"
          @click="dialogOpen = true"
        >
          <Trash2 class="size-4" aria-hidden="true" />
          {{ $t('snapshots.parts.remove') }}
        </UiButton>
        <UiIconButton
          :label="$t('snapshots.parts.hide')"
          :title="$t('snapshots.parts.hideOne')"
          @click="hide(note.part)"
        >
          <X class="size-4" aria-hidden="true" />
        </UiIconButton>
      </span>
    </div>

    <RemovePartDialog
      v-if="canAct"
      :open="dialogOpen"
      :account-id="account.id"
      :not-shared="notShared"
      :guest="mode.guest === true"
      @close="dialogOpen = false"
    />
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.5625rem 0.875rem;
  border: 1px dashed var(--color-border-strong);
  border-radius: 0.5625rem;
  background: var(--color-surface-overlay);
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}
.strip b {
  color: var(--color-text-primary);
  font-weight: 600;
}
</style>
