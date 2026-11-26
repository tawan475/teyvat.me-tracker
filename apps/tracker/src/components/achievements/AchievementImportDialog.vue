<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { FileJson, FileUp } from 'lucide-vue-next'
import type { Achievement } from '@gdt/game-data'
import {
  UIAF_MAX_BYTES,
  UIAF_MAX_ENTRIES,
  UiafError,
  isUiaf,
  parseUiaf,
} from '@gdt/shared/achievements/uiaf'
import {
  parseAchievementImport,
  planAchievementImport,
  type AchievementImportPlan,
  type DoneState,
  type ParsedAchievementImport,
} from '@/data/achievement-progress'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { pickPaimonAccount } from '@/data/paimon-backup'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'

/**
 * Marks achievements done from another tracker's file: a UIAF file (UIGF-Org's
 * standard: Snap Hutao, cocogoat…), a Seelie account export, a paimon.moe
 * backup (one of its accounts: this account's UID, else the user's pick) or
 * a GOOD file with `gi_achievements` (stardb, Teyvat.me Capture). Only ids
 * not already done are added. A UIAF file it refuses says why (too big, too
 * many entries, a version it does not read).
 */
const props = defineProps<{
  open: boolean
  /** This account's UID (picks the paimon.moe account with it). */
  uid?: string | null
  state: DoneState
  known: ReadonlyMap<number, Achievement>
  /** Saves the marks; resolves false when that failed. */
  save: (ids: number[]) => Promise<boolean>
}>()
const emit = defineEmits<{ close: [] }>()

const formatLabel = (parsed: ParsedAchievementImport): string => {
  const format = parsed.format
  return format === 'uiaf'
    ? `UIAF ${parsed.uiaf?.version ?? ''}`.trim()
    : format === 'seelie'
      ? 'Seelie'
      : format === 'paimon'
        ? 'paimon.moe'
        : format === 'good'
          ? 'Leyline/GOOD'
          : t('achievements.import.formats.list')
}

/** Why a UIAF file is refused, in one short line. */
function uiafRefusal(error: UiafError, json: unknown): string {
  switch (error.code) {
    case 'too_big':
      return t('achievements.import.refused.tooBig', {
        mb: formatNumber(UIAF_MAX_BYTES / 1024 / 1024),
      })
    case 'too_many':
      return t('achievements.import.refused.tooMany', { n: formatNumber(UIAF_MAX_ENTRIES) })
    case 'version': {
      const info = (json as { info?: { uiaf_version?: unknown } } | null)?.info
      return t('achievements.import.refused.version', { version: String(info?.uiaf_version ?? '') })
    }
    default:
      return t('achievements.import.refused.malformed')
  }
}

/** UIAF: why its unfinished entries are not kept, and how many more were skipped. */
function notFinishedHint(plan: AchievementImportPlan): string | undefined {
  if (plan.unfinished === undefined) return undefined
  const lines = [t('achievements.import.notFinishedTitle')]
  if (plan.skipped)
    lines.push(t('achievements.import.skippedTitle', { n: formatNumber(plan.skipped) }))
  return lines.join('\n')
}

const input = ref<HTMLInputElement>()
const dragging = ref(false)
const reading = ref(false)
const saving = ref(false)
const fileName = ref('')
const failure = ref('')
const parsed = shallowRef<ParsedAchievementImport | null>(null)
/** paimon.moe: which of the file's accounts. */
const picked = ref(0)
const ids = computed(() => parsed.value?.accounts?.[picked.value]?.ids ?? parsed.value?.ids ?? [])

const plan = computed<AchievementImportPlan | null>(() =>
  parsed.value ? planAchievementImport(ids.value, props.state, props.known, parsed.value) : null,
)
const accountLabel = (a: { value: string; uid: string | null }, i: number) =>
  a.uid ? `UID ${a.uid}` : t('achievements.import.account', { n: i + 1 })

function reset() {
  fileName.value = ''
  failure.value = ''
  parsed.value = null
  dragging.value = false
}
watch(
  () => props.open,
  (open) => open && reset(),
)

async function read(file: File | undefined) {
  if (!file) return
  reset()
  fileName.value = file.name
  reading.value = true
  try {
    const text = await file.text()
    let json: unknown
    try {
      json = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch {
      failure.value = t('achievements.import.notJson')
      return
    }
    // A UIAF file is read with its limits first, so a refusal can say why.
    if (isUiaf(json)) {
      try {
        parseUiaf(text)
      } catch (error) {
        if (!(error instanceof UiafError)) throw error
        failure.value = uiafRefusal(error, json)
        return
      }
    }
    const result = parseAchievementImport(json)
    if (result) {
      picked.value = result.accounts ? pickPaimonAccount(result.accounts, props.uid) : 0
      parsed.value = result
    } else failure.value = t('achievements.import.noAchievements')
  } catch {
    failure.value = t('achievements.import.notJson')
  } finally {
    reading.value = false
  }
}

function onPick(event: Event) {
  const target = event.target as HTMLInputElement
  void read(target.files?.[0])
  target.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  void read(event.dataTransfer?.files[0])
}

async function add() {
  const ids = plan.value?.add
  if (!ids?.length) return
  saving.value = true
  try {
    if (await props.save(ids)) emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" :title="$t('achievements.import.title')" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <div
        class="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-5 py-6 text-center transition-colors"
        :class="dragging ? 'border-accent bg-surface-overlay' : 'border-border-strong'"
        :title="$t('achievements.import.dropTitle')"
        @dragenter.prevent="dragging = true"
        @dragover.prevent
        @dragleave.self="dragging = false"
        @drop.prevent="onDrop"
      >
        <FileUp class="size-8 text-text-muted" aria-hidden="true" />
        <div class="flex flex-col gap-1">
          <p class="text-sm font-medium">{{ $t('achievements.import.drop') }}</p>
          <p class="text-xs text-text-secondary">UIAF · Seelie · paimon.moe · Teyvat.me</p>
        </div>
        <UiButton :loading="reading" @click="input?.click()">{{
          $t('achievements.import.browse')
        }}</UiButton>
        <input
          ref="input"
          type="file"
          accept=".json,application/json"
          class="hidden"
          tabindex="-1"
          aria-hidden="true"
          @change="onPick"
        />
      </div>

      <div v-if="fileName" class="flex flex-col gap-3" aria-live="polite">
        <p class="flex min-w-0 items-center gap-2 text-sm">
          <FileJson class="size-4 shrink-0 text-text-muted" aria-hidden="true" />
          <span class="truncate font-medium">{{ fileName }}</span>
          <span v-if="parsed" class="shrink-0 font-semibold">{{ formatLabel(parsed) }}</span>
        </p>
        <div
          v-if="parsed?.accounts && parsed.accounts.length > 1"
          role="radiogroup"
          :aria-label="$t('achievements.import.fileAccount')"
          class="flex flex-wrap gap-2"
        >
          <FilterChip
            v-for="(a, i) in parsed.accounts"
            :key="a.prefix"
            radio
            :pressed="picked === i"
            :count="a.ids.length"
            @toggle="picked = i"
            >{{ accountLabel(a, i) }}</FilterChip
          >
        </div>
        <p v-if="failure" class="text-sm text-danger-text" role="alert">{{ failure }}</p>
        <div v-else-if="plan && parsed" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <UiStat
            :label="$t('achievements.import.new')"
            :value="plan.add.length"
            exact
            :hint="
              plan.unknown || plan.disused
                ? $t('achievements.import.newTitle', {
                    unknown: formatNumber(plan.unknown),
                    disused: formatNumber(plan.disused),
                  })
                : undefined
            "
          />
          <UiStat :label="$t('achievements.import.already')" :value="plan.already" exact />
          <UiStat
            :label="$t('achievements.import.notFinished')"
            :value="plan.unfinished ?? null"
            exact
            :hint="notFinishedHint(plan)"
          />
          <UiStat :label="$t('achievements.import.unknown')" :value="plan.unknown" exact />
        </div>
      </div>
    </div>

    <template #footer>
      <a
        href="https://uigf.org/"
        target="_blank"
        rel="noopener"
        class="mr-auto self-center text-xs font-medium text-accent-text underline-offset-2 hover:underline"
        >UIGF-Org</a
      >
      <UiButton variant="ghost" @click="emit('close')">{{
        $t('achievements.import.cancel')
      }}</UiButton>
      <UiButton variant="primary" :disabled="!plan?.add.length" :loading="saving" @click="add">
        {{
          $t('achievements.import.add', {
            n: plan?.add.length ? formatNumber(plan.add.length) : '',
          })
        }}
      </UiButton>
    </template>
  </UiModal>
</template>
