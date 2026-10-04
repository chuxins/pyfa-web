<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onUnauthorized } from '@/api'
import { useSessionStore } from '@/stores/session'
import { useBrowserStore } from '@/stores/browser'
import { useFittingStore } from '@/stores/fitting'
import { ssoErrorText } from '@/errors'
import { LOCALES, locale, setLocale, t, type LocaleCode } from '@/i18n'
import ShipBrowser from '@/components/ShipBrowser.vue'
import FittingView from '@/components/FittingView.vue'
import LoginPrompt from '@/components/LoginPrompt.vue'
import StatsPane from '@/components/StatsPane.vue'
import ItemBrowser from '@/components/ItemBrowser.vue'
import ItemDetails from '@/components/ItemDetails.vue'

const session = useSessionStore()
const browser = useBrowserStore()
const fitting = useFittingStore()

const itemPaneOpen = ref(true)
const detailsOpen = ref(false)

/**
 * Narrow windows give up the three-pane desktop layout for a tabbed one: one pane on
 * screen at a time, switched from a bottom tab bar. This is the width below which the
 * desktop grid (280px sidebar + min 420px assembly + 340px stats) would overflow, so it
 * is the same number in the CSS media queries and here.
 */
const MOBILE_QUERY = '(max-width: 1040px)'
type MobileView = 'ships' | 'fit' | 'stats' | 'items'

const isMobile = ref(false)
/** Which pane the mobile layout is showing; ignored on the desktop layout. */
const mobileView = ref<MobileView>('ships')
let mobileQuery: MediaQueryList | null = null

function onMobileChange(event: MediaQueryListEvent | MediaQueryList) {
  isMobile.value = event.matches
  // The item pane's show/hide toggle is a desktop control; on a phone the item browser
  // is a tab, so it has to exist for that tab to have anything to show.
  if (isMobile.value) itemPaneOpen.value = true
}

/** How long a refused login stays on screen before it gets out of the way again. */
const SSO_ERROR_TIMEOUT = 8000

/** Set from `?sso_error=` when EVE sent the browser back with a refusal. */
const ssoError = ref<string | null>(null)
let ssoErrorTimer: number | undefined

/** Where the sign-in link sends the browser back to, so the page is not lost. */
const signInHref = computed(() => {
  const here = window.location.pathname + window.location.search
  return '/api/auth/login?next=' + encodeURIComponent(here || '/')
})

/** Read a refusal out of the address bar and drop it, so a reload is a clean start. */
function takeSsoError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('sso_error')
  if (!code) return null
  params.delete('sso_error')
  const query = params.toString()
  window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''))
  return ssoErrorText(code)
}

// Picking a fit in the ship browser opens it; on a phone that means leaving the ship
// tree for the assembly page so the open fit is actually on screen.
watch(
  () => fitting.fit?.id,
  (id) => {
    if (isMobile.value && id !== undefined && id !== null && mobileView.value === 'ships') {
      mobileView.value = 'fit'
    }
  },
)

onMounted(async () => {
  // A write the server turns down for want of a session raises the sign-in prompt instead
  // of a banner the click cannot act on (see @/api, @/components/LoginPrompt.vue)
  onUnauthorized(() => session.promptLogin())

  mobileQuery = window.matchMedia(MOBILE_QUERY)
  onMobileChange(mobileQuery)
  mobileQuery.addEventListener('change', onMobileChange)

  ssoError.value = takeSsoError()
  if (ssoError.value) {
    ssoErrorTimer = window.setTimeout(() => (ssoError.value = null), SSO_ERROR_TIMEOUT)
  }

  await session.load()
  // The tree, the fit list, the live stream and the assembly page are all open to
  // everyone: a guest works in the shared guest database, and only the two actions
  // that act as the pilot (importing from / exporting to EVE) ask for a login.
  await browser.loadTree()
  fitting.connect()
  // Land on the fit last worked on: the assembly page is the view to come up on, rather
  // than an empty frame between the browser and the stats.
  await fitting.openLast()
})

onUnmounted(() => {
  fitting.disconnect()
  mobileQuery?.removeEventListener('change', onMobileChange)
  mobileQuery = null
  if (ssoErrorTimer) window.clearTimeout(ssoErrorTimer)
})

const showDetails = computed(() => browser.selectedItem !== null)

/** One line for whatever went wrong or just happened, whichever store said it. */
const bannerError = computed(() => fitting.error || browser.error)
const bannerNotice = computed(() => fitting.notice || browser.notice || ssoError.value)

/** The picker writes the choice to localStorage, so it outlives the page. */
function changeLocale(event: Event) {
  setLocale((event.target as HTMLSelectElement).value as LocaleCode)
}
</script>

<template>
  <div class="shell" :class="{ 'items-tab': isMobile && mobileView === 'items' }">
    <header class="topbar">
      <div class="brand">
        <strong>pyfa</strong><span class="dim">web</span>
      </div>

      <div v-if="fitting.fit" class="fitbar">
        <span class="shipname">{{ fitting.fit.ship.item.name }}</span>
        <input
          class="fitname"
          :value="fitting.fit.name"
          @change="fitting.rename(($event.target as HTMLInputElement).value)"
        />
        <button :disabled="!fitting.history.canUndo || fitting.busy" :title="fitting.history.undoName ?? 'Undo'" @click="fitting.undo()">
          &#8630; {{ t('Undo') }}
        </button>
        <button :disabled="!fitting.history.canRedo || fitting.busy" :title="fitting.history.redoName ?? 'Redo'" @click="fitting.redo()">
          &#8631; {{ t('Redo') }}
        </button>
        <button :disabled="fitting.busy" @click="fitting.reset()">{{ t('Clear fit') }}</button>
        <button :disabled="fitting.exporting" @click="fitting.exportTxt()">{{ t('Export TXT') }}</button>
        <button :disabled="fitting.exporting" @click="fitting.exportToGame()">
          {{ t('Export to Game') }}
        </button>
        <span v-if="fitting.exporting" class="dim">{{ t('exporting…') }}</span>
        <span v-if="fitting.busy" class="dim">{{ t('working…') }}</span>
      </div>

      <div class="spacer" />

      <button class="itembtn" @click="itemPaneOpen = !itemPaneOpen">
        {{ t(itemPaneOpen ? 'Hide item browser' : 'Show item browser') }}
      </button>
      <select class="lang" :value="locale" :title="t('Interface language')" @change="changeLocale">
        <option v-for="entry in LOCALES" :key="entry.code" :value="entry.code">{{ entry.label }}</option>
      </select>
      <span v-if="session.signedIn" class="user">
        {{ session.user?.characterName }}
        <button @click="session.logout()">{{ t('Sign out') }}</button>
      </span>
      <a v-else class="signin" :href="signInHref">{{ t('Sign in with EVE') }}</a>
      <span
        class="dim version"
        :title="t('gamedata build {build}', { build: session.gamedata.build })"
      >v{{ session.pyfaVersion }}</span>
    </header>

    <div v-if="bannerError" class="banner error">{{ bannerError }}</div>
    <div v-else-if="bannerNotice" class="banner notice">{{ bannerNotice }}</div>

    <main class="body">
      <ShipBrowser
        class="sidebar"
        :class="{ 'mobile-pane': isMobile, active: isMobile && mobileView === 'ships' }"
      />

      <section
        class="center"
        :class="{ 'mobile-pane': isMobile, active: isMobile && mobileView === 'fit' }"
      >
        <FittingView v-if="fitting.fit" />
        <div v-else class="placeholder">
          <h2>{{ t('No fit open') }}</h2>
          <p class="dim">{{ t('Pick a ship on the left, then open one of its fits or create a new one.') }}</p>
        </div>
      </section>

      <aside
        class="right"
        :class="{ 'mobile-pane': isMobile, active: isMobile && mobileView === 'stats' }"
      >
        <!-- On a phone the details pane is a full-screen sheet (see the overlay below);
             the desktop layout keeps it in this column, in front of the stats. -->
        <ItemDetails v-if="showDetails && !isMobile" @close="browser.clearItem()" />
        <StatsPane v-else-if="!showDetails" />
      </aside>
    </main>

    <ItemBrowser
      v-if="itemPaneOpen"
      class="itembar"
      :class="{ 'mobile-pane': isMobile, active: isMobile && mobileView === 'items' }"
    />

    <nav v-if="isMobile" class="mobiletabs">
      <button :class="{ active: mobileView === 'ships' }" @click="mobileView = 'ships'">{{ t('Ships') }}</button>
      <button :class="{ active: mobileView === 'fit' }" @click="mobileView = 'fit'">{{ t('Fit') }}</button>
      <button :class="{ active: mobileView === 'stats' }" @click="mobileView = 'stats'">{{ t('Stats') }}</button>
      <button :class="{ active: mobileView === 'items' }" @click="mobileView = 'items'">{{ t('Items') }}</button>
    </nav>

    <ItemDetails v-if="showDetails && isMobile" class="details-overlay" @close="browser.clearItem()" />

    <LoginPrompt v-if="session.loginPrompt" @close="session.dismissLoginPrompt()" />
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  height: 100%;
}

/* Explicit rows: the banner between the top bar and the body only exists while a
   message is up, so auto-placement alone would shift the body into an auto row,
   grow the page past the viewport and push the tab bar off the bottom. Pinning
   each pane to its row keeps the 1fr body row doing the shrinking. */
.topbar {
  grid-row: 1;
}

.banner {
  grid-row: 2;
}

.body {
  grid-row: 3;
}

.itembar {
  grid-row: 4;
}

.mobiletabs {
  grid-row: 5;
  display: none;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}

.brand {
  font-size: 15px;
  letter-spacing: 0.02em;
  margin-right: 8px;
}

.brand span {
  margin-left: 4px;
}

.fitbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.shipname {
  font-weight: 600;
}

.fitname {
  width: 190px;
}

.spacer {
  flex: 1;
}

.user {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version {
  font-size: 11px;
}

.lang {
  font-size: 11px;
  padding: 1px 4px;
}

.banner {
  padding: 6px 12px;
  font-size: 12px;
}

.banner.error {
  background: var(--danger);
  color: #fff;
}

.banner.notice {
  background: var(--accent-dim);
}

.body {
  display: grid;
  grid-template-columns: 280px minmax(420px, 1fr) 340px;
  min-height: 0;
}

.sidebar {
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  min-height: 0;
}

.center {
  min-height: 0;
  overflow: auto;
}

.right {
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  min-height: 0;
  overflow: auto;
}

.itembar {
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  height: 240px;
}

.placeholder {
  padding: 40px;
  text-align: center;
}

.placeholder h2 {
  margin: 0 0 6px;
  font-weight: 600;
}

.hint {
  margin-top: 14px;
  max-width: 32rem;
  margin-left: auto;
  margin-right: auto;
}

/* ---- narrow windows: one pane at a time, switched from a bottom tab bar ---------------
   Below the width the three-pane desktop grid needs, the shell becomes a tabbed layout:
   the top bar wraps, only the active pane is on screen, and item details turn into a
   full-screen sheet. The same 1040px threshold drives `matchMedia` in the script. */
@media (max-width: 1040px) {
  .shell {
    grid-template-rows: auto auto 1fr auto auto;
    /* 100vh first, then 100dvh where supported: the dynamic viewport tracks the
       browser chrome collapsing, so the tab bar stays on the visible bottom edge
       instead of being cut off or floating over blank space. overflow:hidden keeps
       the page itself from ever scrolling past the pinned bar. */
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .topbar {
    flex-wrap: wrap;
    gap: 6px 8px;
    /* The shell now reaches under the notch (viewport-fit=cover), so the bar's own
       padding has to grow by the inset to keep the controls clear of it. */
    padding-top: calc(7px + env(safe-area-inset-top));
  }

  .brand {
    font-size: 14px;
  }

  .fitbar {
    flex: 1 1 100%;
    order: 2;
    flex-wrap: wrap;
    gap: 6px;
  }

  .fitbar button {
    min-height: 34px;
  }

  .shipname {
    line-height: 1.2;
  }

  .fitname {
    width: auto;
    flex: 1 1 140px;
    min-width: 0;
    /* 16px so iOS does not zoom the page when the fit name is being edited */
    font-size: 16px;
  }

  .lang {
    font-size: 16px;
    min-height: 32px;
  }

  .topbar .signin,
  .topbar .user {
    min-height: 32px;
  }

  /* The show/hide toggle belongs to the desktop item bar; on a phone the item
     browser is one of the tabs, so the toggle is not offered. */
  .itembtn {
    display: none;
  }

  .body {
    display: block;
    position: relative;
    min-height: 0;
  }

  .sidebar {
    border-right: none;
  }

  .right {
    border-left: none;
  }

  .mobile-pane {
    height: 100%;
    min-height: 0;
  }

  /* Hide every pane but the active one without forcing display:block on it: the
     ships pane is its own grid (ShipBrowser .browser) and the item pane its own
     grid (.itembrowser), so a blanket block would collapse their 1fr rows -- and
     the internal scroll with them. The center/right sections are block already. */
  .mobile-pane:not(.active) {
    display: none;
  }

  /* The item pane lives in its own grid row under the body. While its tab is on screen
     that row takes the flexible height, so the results list scrolls inside the pane
     instead of growing the page; every other tab leaves the row empty. */
  .shell.items-tab {
    grid-template-rows: auto auto auto 1fr auto;
  }

  .itembar {
    height: 100%;
  }

  .mobiletabs {
    display: flex;
    border-top: 1px solid var(--border);
    background: var(--bg-panel);
    /* Home-screen browsers draw the bar above the gesture strip; the strip stays clear */
    padding-bottom: env(safe-area-inset-bottom);
  }

  .mobiletabs button {
    flex: 1;
    border: none;
    border-radius: 0;
    background: none;
    min-height: 48px;
    padding: 10px 2px;
    font-size: 13px;
    color: var(--text-dim);
  }

  .mobiletabs button.active {
    color: var(--accent);
    box-shadow: inset 0 2px 0 var(--accent);
  }

  /* The details pane as a full-screen sheet on a phone (see the template) */
  .details-overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: var(--bg);
  }
}
</style>
