<script setup lang="ts">
import { Download } from 'lucide-vue-next'
import { useSession } from '@/stores/session'
import DemoVideo from './DemoVideo.vue'
import LandingTry from './LandingTry.vue'
import { DOWNLOAD_URL } from './links'

const session = useSession()
</script>

<template>
  <section class="sky e-hero" aria-labelledby="he-title">
    <div class="wrap e-band">
      <div class="e-txt">
        <!-- What the site is, for people and crawlers alike: the name, then the kind of site. -->
        <h1 id="he-title" class="h1">
          <span class="spark" aria-hidden="true">✦</span> Teyvat.me<span class="sr-only">: </span>
          <span class="e-kind">{{ $t('landing.hero.title') }}</span>
        </h1>
        <p class="lead">{{ $t('landing.hero.lead') }}</p>
        <!-- The tracker first, then the demo (no sign-up), the capture app last. -->
        <div class="acts">
          <RouterLink
            v-if="session.status === 'signed-in'"
            :to="{ name: 'home' }"
            class="btn btn-p"
          >
            {{ $t('landing.hero.open') }}
          </RouterLink>
          <RouterLink v-else :to="{ name: 'register' }" class="btn btn-p">
            {{ $t('landing.hero.track') }}
          </RouterLink>
          <LandingTry />
          <a class="btn btn-g" :href="DOWNLOAD_URL">
            <Download class="ic" aria-hidden="true" />{{ $t('landing.hero.download') }}
          </a>
        </div>
        <p class="muted e-note">{{ $t('landing.hero.note') }}</p>
      </div>
      <div class="e-media">
        <DemoVideo />
      </div>
    </div>
  </section>
</template>
