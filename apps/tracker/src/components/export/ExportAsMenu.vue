<script setup lang="ts" generic="P extends ExportPage">
import { nextTick, ref, shallowRef, useTemplateRef } from 'vue'
import { ChevronDown, Download } from 'lucide-vue-next'
import type { ExportPage, PageInputs } from '@/data/export-formats'
import UiButton from '@/components/ui/UiButton.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import { t } from '@/i18n'
import { useFeedback } from '@/stores/feedback'
import type { LeavesOutWords } from './export-words'

/**
 * "Export as…" on a page (the owner's design C, 2026-11-26): a button and a
 * popover (a bottom sheet on phones) listing the page's formats from the
 * registry (`formatsFor(page)`, data/export-formats.ts): the format's name,
 * the tools that read it, and what it leaves out of this account's data. A
 * row builds its file in the browser and downloads it.
 *
 * `formats` names the registry rows whose data exists (the page knows: a
 * capture, pulls, done achievements); with none the button is not shown.
 * The registry, its converters and `load` (the page's data for the files)
 * are read only when the menu opens, so no page's first load carries them.
 */
const props = withDefaults(
  defineProps<{
    page: P
    formats: readonly string[]
    load: () => Promise<PageInputs[P]>
    size?: 'md' | 'sm'
  }>(),
  { size: 'md' },
)

interface Row {
  id: string
  name: string
  readers: string
  leaves: LeavesOutWords | null
  /** Builds the file and hands it to the browser as a download. */
  save: () => void
}

const feedback = useFeedback()
const anchor = useTemplateRef<HTMLElement>('anchor')
const popover = useTemplateRef<{ place: () => void }>('popover')
const open = ref(false)
const rows = shallowRef<Row[] | null>(null)
const building = ref<string | null>(null)
/** The UIGF-Org link (its standards ask for it where support is declared). */
const uigf = ref(false)
let opened = 0

async function toggle() {
  if (open.value) return close()
  open.value = true
  rows.value = null
  const token = ++opened
  try {
    const [{ formatsFor }, { leavesOutLine }, { saveBlob }, input] = await Promise.all([
      import('@/data/export-formats'),
      import('./export-words'),
      import('@/data/export'),
      props.load(),
    ])
    if (token !== opened || !open.value) return
    const list = formatsFor(props.page)
      .filter((f) => props.formats.includes(f.id))
      .map<Row>((f) => ({
        id: f.id,
        name: f.name,
        // The tools that read it; for the Teyvat.me file (none named) that it imports back here.
        readers: f.readers.length
          ? f.readers.join(', ')
          : f.importsBack
            ? t('transfer.exportAs.importsBack')
            : '',
        leaves: leavesOutLine(f.leavesOut(input)),
        save: () => {
          const file = f.build(input)
          saveBlob(new Blob([file.text], { type: file.type }), f.fileName(input))
        },
      }))
    uigf.value = list.some((r) => r.id === 'uigf' || r.id === 'uiaf')
    rows.value = list
    await nextTick()
    popover.value?.place()
  } catch (error) {
    if (token !== opened) return
    close()
    feedback.error(t('transfer.export.failed'), error)
  }
}

function close() {
  open.value = false
  opened++
}

/** The next paint, so the row's spinner shows before a long build. */
const painted = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

async function pick(row: Row) {
  if (building.value) return
  building.value = row.id
  try {
    await painted()
    row.save()
    close()
  } catch (error) {
    feedback.error(t('transfer.export.failed'), error)
  } finally {
    building.value = null
  }
}
</script>

<template>
  <span v-if="formats.length" ref="anchor" class="inline-flex shrink-0">
    <UiButton :size="size" :aria-expanded="open" aria-haspopup="menu" @click="toggle">
      <Download class="size-4" aria-hidden="true" />{{ $t('transfer.exportAs.button') }}
      <ChevronDown class="size-4" aria-hidden="true" />
    </UiButton>
    <UiPopover
      ref="popover"
      :open="open"
      :anchor="anchor"
      :label="$t('transfer.exportAs.button')"
      :focus="false"
      @close="close"
    >
      <div v-if="!rows" class="flex justify-center p-6 text-text-muted" aria-busy="true">
        <UiSpinner class="size-5" />
      </div>
      <template v-else>
        <div class="flex flex-col divide-y divide-border-default p-1.5" role="menu">
          <button
            v-for="row in rows"
            :key="row.id"
            type="button"
            role="menuitem"
            class="flex min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-overlay focus-visible:bg-surface-overlay disabled:cursor-default"
            :disabled="building !== null"
            :aria-busy="building === row.id || undefined"
            :title="row.leaves?.full"
            @click="pick(row)"
          >
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate text-[0.9375rem] font-semibold text-text-primary">{{
                row.name
              }}</span>
              <span v-if="row.readers" class="truncate text-xs text-text-secondary">{{
                row.readers
              }}</span>
              <span v-if="row.leaves" class="truncate text-xs text-text-muted">{{
                row.leaves.short
              }}</span>
            </span>
            <UiSpinner v-if="building === row.id" class="size-4 shrink-0 text-text-muted" />
            <Download v-else class="size-4 shrink-0 text-text-muted" aria-hidden="true" />
          </button>
        </div>
        <div v-if="uigf" class="border-t border-border-default px-4 py-2.5 text-xs">
          <a
            href="https://uigf.org/"
            target="_blank"
            rel="noopener"
            class="font-medium text-accent-text underline-offset-2 hover:underline"
            >UIGF-Org</a
          >
        </div>
      </template>
    </UiPopover>
  </span>
</template>
