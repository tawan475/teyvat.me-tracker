<script setup lang="ts">
import AppPanel from '@/components/settings/AppPanel.vue'
import AppearancePanel from '@/components/settings/AppearancePanel.vue'
import ConnectedAccountsPanel from '@/components/settings/ConnectedAccountsPanel.vue'
import DeleteUserPanel from '@/components/settings/DeleteUserPanel.vue'
import DevicesSummary from '@/components/settings/DevicesSummary.vue'
import PasswordPanel from '@/components/settings/PasswordPanel.vue'
import ProfilePanel from '@/components/settings/ProfilePanel.vue'
import SettingsSection from '@/components/settings/SettingsSection.vue'
import SupportPanel from '@/components/settings/SupportPanel.vue'
import UserImportKeyPanel from '@/components/settings/UserImportKeyPanel.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { AppWindow, Palette, Shield, TriangleAlert } from 'lucide-vue-next'
</script>

<template>
  <PageHeader :title="$t('shell.page.settings')" />

  <!-- In order: the user, then how the site looks, then the app itself, then
       the danger zone; each section a title column beside a two-column grid. -->
  <div class="mx-auto flex w-full max-w-[1500px] flex-col">
    <SettingsSection
      :label="$t('shell.section.account')"
      :description="$t('settings.sections.account')"
      :icon="Shield"
    >
      <ProfilePanel class="col-span-full" />
      <PasswordPanel class="min-w-0" />
      <ConnectedAccountsPanel class="min-w-0" />
      <DevicesSummary class="min-w-0" />
      <UserImportKeyPanel class="min-w-0" />
    </SettingsSection>
    <SettingsSection
      :label="$t('settings.appearance.title')"
      :description="$t('settings.sections.appearance')"
      :icon="Palette"
    >
      <AppearancePanel class="col-span-full" />
    </SettingsSection>
    <SettingsSection
      :label="$t('settings.app.title')"
      :description="$t('settings.sections.app')"
      :icon="AppWindow"
    >
      <AppPanel class="col-span-full" />
      <SupportPanel class="col-span-full" />
    </SettingsSection>
    <SettingsSection
      :label="$t('settings.sections.danger')"
      :description="$t('settings.sections.dangerUser')"
      :icon="TriangleAlert"
    >
      <DeleteUserPanel class="col-span-full" />
    </SettingsSection>
  </div>
</template>
