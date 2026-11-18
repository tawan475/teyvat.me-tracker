<script setup lang="ts">
import { ArrowRight, Download, Lock, Trash2 } from 'lucide-vue-next'
</script>

<template>
  <section id="privacy" class="sec" aria-labelledby="pv-t">
    <div class="wrap">
      <div class="sec-h">
        <div class="ov">{{ $t('landing.privacy.overline') }}</div>
        <h2 id="pv-t" class="h2">{{ $t('landing.privacy.title') }}</h2>
      </div>
      <div class="priv">
        <div class="tile-g pv">
          <Lock class="ic l" aria-hidden="true" />
          <div>
            <b>{{ $t('landing.privacy.yours') }}</b
            ><span>{{ $t('landing.privacy.yoursNote') }}</span>
          </div>
        </div>
        <div class="tile-g pv">
          <Download class="ic l" aria-hidden="true" />
          <div>
            <b>{{ $t('landing.privacy.export') }}</b
            ><span>{{ $t('landing.privacy.exportNote') }}</span>
          </div>
        </div>
        <div class="tile-g pv">
          <Trash2 class="ic l" aria-hidden="true" />
          <div>
            <b>{{ $t('landing.privacy.delete') }}</b
            ><span>{{ $t('landing.privacy.deleteNote') }}</span>
          </div>
        </div>
      </div>
      <RouterLink :to="{ name: 'privacy' }" class="more-l"
        >{{ $t('landing.privacy.details') }}<ArrowRight class="ic" aria-hidden="true"
      /></RouterLink>
    </div>
  </section>
</template>
