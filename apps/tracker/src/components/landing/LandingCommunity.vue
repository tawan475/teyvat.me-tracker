<script setup lang="ts">
import { ArrowUpRight, Code, Heart } from 'lucide-vue-next'
import { DISCORD_URL, KOFI_URL } from '@/lib/links'
import DiscordMark from './DiscordMark.vue'
import { GITHUB_URL } from './links'

/**
 * "Join our community", after the FAQ (the user's pick, 2026-11-19: option C
 * of https://claude.ai/artifact/FGBTwZdsTvrucA1F9gsJGD): three doors, Discord
 * the wide one with its Join button, then GitHub and Ko-fi.
 */
</script>

<template>
  <section id="community" class="sec sky" aria-labelledby="com-t">
    <div class="wrap">
      <div class="sec-h">
        <div class="ov">{{ $t('landing.community.overline') }}</div>
        <h2 id="com-t" class="h2">{{ $t('landing.community.title') }}</h2>
      </div>
      <div class="doors">
        <a class="tile-g door main" :href="DISCORD_URL" target="_blank" rel="noopener noreferrer">
          <span class="disc"><DiscordMark /></span>
          <span class="join-t">
            <b>Discord</b>
            <span>{{ $t('landing.community.discord') }}</span>
          </span>
          <span class="btn btn-sm btn-dc">{{ $t('landing.community.join') }}</span>
        </a>
        <a class="tile-g door" :href="GITHUB_URL" target="_blank" rel="noopener noreferrer">
          <span class="door-top">
            <span class="ft-ic"><Code class="ic l" aria-hidden="true" /></span>
            <b>GitHub</b>
            <ArrowUpRight class="ic" aria-hidden="true" />
          </span>
          <span class="door-p">{{ $t('landing.community.github') }}</span>
        </a>
        <a class="tile-g door" :href="KOFI_URL" target="_blank" rel="noopener noreferrer">
          <span class="door-top">
            <span class="ft-ic"><Heart class="ic l" aria-hidden="true" /></span>
            <b>Ko-fi</b>
            <ArrowUpRight class="ic" aria-hidden="true" />
          </span>
          <span class="door-p">{{ $t('landing.community.kofi') }}</span>
        </a>
      </div>
    </div>
  </section>
</template>
