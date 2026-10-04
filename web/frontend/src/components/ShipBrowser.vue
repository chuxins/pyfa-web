<script setup lang="ts">
import { computed } from 'vue'
import { raceKey, raceSections, useBrowserStore } from '@/stores/browser'
import type { RaceSection } from '@/stores/browser'
import { useFittingStore } from '@/stores/fitting'
import { imageUrl, type FitSummary } from '@/api'
import { t } from '@/i18n'

const browser = useBrowserStore()
const fitting = useFittingStore()

/**
 * Whether a group's race row is closed. Races come up open -- a race is what a group's
 * ships are -- so only the ones the user has folded away are remembered, in the store's
 * `collapsedRaces` under the key `raceKey` builds.
 */
function raceCollapsed(categoryKey: string, groupName: string, section: RaceSection) {
  return !!section.name && !!browser.collapsedRaces[raceKey(categoryKey, groupName, section.name)]
}

const shipQuery = computed({
  get: () => browser.shipFilter,
  set: (value: string) => browser.searchShips(value),
})

async function openFit(fitId: number) {
  await fitting.open(fitId)
}

async function newFit() {
  if (browser.shipId === null) return
  const fitId = await fitting.create(browser.shipId)
  if (fitId !== null) browser.noteFitAdded(browser.shipId)
}

/**
 * Delete a fit the web owns, or explain why the game has to: the row carries the flags
 * that say where the fit came from, so the store can tell the two apart (see the store).
 */
function removeFit(fit: FitSummary) {
  void fitting.removeFit(fit.id, fit)
}

/** What the delete button's tooltip says: the reason a fit cannot be deleted here. */
function deleteTitle(fit: FitSummary): string {
  if (fit.fromGame) return t('This fit came from EVE; delete it in the game')
  if (fit.importedToGame) return t('Please delete this fit in the game')
  return t('Delete')
}

function renderUrl(ship: { image?: { kind: string; id: number } | null }) {
  return imageUrl(ship.image as any, 1)
}
</script>

<template>
  <div class="browser">
    <div class="search">
      <input v-model="shipQuery" :placeholder="t('Search ships…')" spellcheck="false" />
    </div>

    <button class="esi" :disabled="browser.importing" @click="browser.importFromEsi()">
      {{ browser.importing ? t('importing…') : t('Import my EVE fits') }}
    </button>

    <div class="scroll tree">
      <!-- Search results replace the tree while a query is active -->
      <template v-if="browser.shipSearchResults">
        <div class="header">{{ t('Results ({count})', { count: browser.shipSearchResults.length }) }}</div>
        <template v-for="ship in browser.shipSearchResults" :key="ship.id">
          <button
            class="shiprow"
            :class="{ selected: ship.id === browser.shipId }"
            @click="browser.selectShip(ship.id)"
          >
            <img v-if="renderUrl(ship)" :src="renderUrl(ship)!" alt="" loading="lazy" />
            <span>{{ ship.name }}</span>
          </button>
        </template>
      </template>

      <template v-else>
        <template v-for="category in browser.categories" :key="category.key">
          <button class="header toggle" @click="browser.toggleCategory(category.key)">
            {{ browser.collapsedCategories[category.key] ? '▸' : '▾' }} {{ category.name }}
          </button>
          <template v-if="!browser.collapsedCategories[category.key]">
            <template v-for="group in category.groups" :key="group.id">
              <button
                class="group toggle"
                @click="browser.toggleGroup(category.key, group.name)"
              >
                {{ browser.collapsedGroups[`${category.key}/${group.name}`] ? '▸' : '▾' }}
                {{ group.name }}
                <span class="dim">{{ group.ships.length }}</span>
              </button>
              <template v-if="!browser.collapsedGroups[`${category.key}/${group.name}`]">
                <!-- A group that fields more than one race draws a row per race above its
                     ships: that is the level below a group, 舰船 -> 巡洋舰 -> 艾玛 ->
                     预言级. A group of a single race has nothing to split. -->
                <template v-for="section in raceSections(group.ships)" :key="section.name ?? ''">
                  <button
                    v-if="section.name"
                    class="race toggle"
                    @click="browser.toggleRace(category.key, group.name, section.name)"
                  >
                    {{ raceCollapsed(category.key, group.name, section) ? '▸' : '▾' }}
                    {{ section.name }}
                    <span class="dim">{{ section.ships.length }}</span>
                  </button>
                  <template v-if="!raceCollapsed(category.key, group.name, section)">
                    <template v-for="ship in section.ships" :key="ship.id">
                      <button
                        class="shiprow"
                        :class="{ selected: ship.id === browser.shipId, 'in-race': !!section.name }"
                        @click="browser.selectShip(ship.id)"
                      >
                        <!-- The caret is its own click target: showing the fits should not
                             also open the ship's detail pane -->
                        <span
                          v-if="ship.fitCount"
                          class="caret"
                          :title="t('Show the fits saved for this ship')"
                          @click.stop="browser.toggleShipFits(ship.id)"
                        >{{ browser.expandedShips[ship.id] ? '▾' : '▸' }}</span>
                        <span v-else class="caret blank"></span>
                        <img v-if="renderUrl(ship)" :src="renderUrl(ship)!" alt="" loading="lazy" />
                        <span class="shipname">{{ ship.name }}</span>
                        <span v-if="ship.fitCount" class="dim count">{{ ship.fitCount }}</span>
                      </button>
                      <template v-if="ship.fitCount && browser.expandedShips[ship.id]">
                        <div
                          v-if="browser.loadingFits[ship.id]"
                          class="dim nested"
                          :class="{ deep: !!section.name }"
                        >
                          {{ t('reading fits…') }}
                        </div>
                        <div
                          v-for="fit in browser.shipFitsById[ship.id] ?? []"
                          :key="fit.id"
                          class="fitrow nested"
                          :class="{ selected: fitting.fit?.id === fit.id, deep: !!section.name }"
                          role="button"
                          tabindex="0"
                          @click="openFit(fit.id)"
                          @keydown.enter.prevent="openFit(fit.id)"
                          @keydown.space.prevent="openFit(fit.id)"
                        >
                          <span class="fitlabel">
                            <span class="fitname">{{ fit.name }}</span>
                            <span v-if="fit.booster" class="tag">{{ t('booster') }}</span>
                          </span>
                          <button class="fitdelete" :title="deleteTitle(fit)" @click.stop="removeFit(fit)">
                            &times;
                          </button>
                        </div>
                      </template>
                    </template>
                  </template>
                </template>
              </template>
            </template>
          </template>
        </template>
      </template>
    </div>

    <div v-if="browser.ship" class="shipdetail">
      <div class="shiphead">
        <img v-if="renderUrl(browser.ship)" :src="renderUrl(browser.ship)!" alt="" />
        <div>
          <div class="shipname">{{ browser.ship.name }}</div>
          <div class="dim slots">
            <span>{{ t('hi') }} {{ browser.shipSlots.high }}</span>
            <span>{{ t('med') }} {{ browser.shipSlots.med }}</span>
            <span>{{ t('low') }} {{ browser.shipSlots.low }}</span>
            <span>{{ t('rig') }} {{ browser.shipSlots.rig }}</span>
            <span v-if="browser.shipSlots.subsystem">{{ t('sub') }} {{ browser.shipSlots.subsystem }}</span>
          </div>
        </div>
      </div>

      <button class="primary newfit" :disabled="fitting.busy" @click="newFit">+ {{ t('New fit') }}</button>

      <div class="fits scroll">
        <div v-if="!browser.shipFits.length" class="dim empty">{{ t('No saved fits yet') }}</div>
        <div
          v-for="fit in browser.shipFits"
          :key="fit.id"
          class="fitrow"
          :class="{ selected: fitting.fit?.id === fit.id }"
          role="button"
          tabindex="0"
          @click="openFit(fit.id)"
          @keydown.enter.prevent="openFit(fit.id)"
          @keydown.space.prevent="openFit(fit.id)"
        >
          <span class="fitlabel">
            <span class="fitname">{{ fit.name }}</span>
            <span v-if="fit.booster" class="tag">{{ t('booster') }}</span>
          </span>
          <button class="fitdelete" :title="deleteTitle(fit)" @click.stop="removeFit(fit)">
            &times;
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.browser {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  height: 100%;
  min-height: 0;
}

.search {
  padding: 8px;
}

.search input {
  width: 100%;
}

.esi {
  margin: 0 8px 6px;
}

.tree {
  padding: 0 4px;
  min-height: 0;
}

.header {
  width: 100%;
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
  background: none;
  border: none;
  padding: 6px 6px 3px;
}

.toggle {
  cursor: pointer;
}

.group {
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 3px 6px 3px 16px;
  color: var(--text);
  display: flex;
  justify-content: space-between;
}

.group:hover {
  background: var(--bg-hover);
}

.shiprow {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  background: none;
  border: none;
  padding: 2px 6px 2px 16px;
  border-radius: 3px;
}

.caret {
  width: 10px;
  color: var(--text-dim);
  font-size: 10px;
}

.caret.blank {
  display: inline-block;
}

.shiprow img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.shipname {
  flex: 1;
}

.count {
  font-size: 11px;
}

.shiprow:hover {
  background: var(--bg-hover);
}

.shiprow.selected {
  background: var(--accent-dim);
}

.shipdetail {
  border-top: 1px solid var(--border);
  padding: 8px;
  display: grid;
  gap: 6px;
  max-height: 45%;
  grid-template-rows: auto auto 1fr;
}

.shiphead {
  display: flex;
  gap: 8px;
  align-items: center;
}

.shiphead img {
  width: 44px;
  height: 44px;
  object-fit: contain;
}

.shipname {
  font-weight: 600;
}

.slots {
  display: flex;
  gap: 7px;
  font-size: 11px;
}

.newfit {
  width: 100%;
}

.fits {
  display: grid;
  gap: 2px;
  align-content: start;
  min-height: 60px;
}

.fitrow {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  align-items: center;
  text-align: left;
  background: none;
  border: none;
  padding: 3px 6px;
  cursor: pointer;
}

/* The name and its tag stay together on the left; the delete button sits far right. */
.fitlabel {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.fitdelete {
  background: none;
  border: none;
  padding: 0 2px;
  font-size: 13px;
  line-height: 1;
  color: var(--text-dim);
  cursor: pointer;
}

.fitdelete:hover {
  color: var(--danger);
}

.fitrow.nested {
  padding-left: 42px;
  color: var(--text-dim);
}

.nested {
  padding-left: 42px;
}

.fitrow:hover {
  background: var(--bg-hover);
}

.fitrow.selected {
  background: var(--accent-dim);
}

.empty {
  padding: 6px;
  font-size: 12px;
}

/* The tree's level below a group: one row per race where a group fields more than one,
   the way the desktop browses 舰船 -> 巡洋舰 -> 艾玛 -> 预言级. */
.race {
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 2px 6px 2px 28px;
  color: var(--text-dim);
  font-size: 12px;
  display: flex;
  justify-content: space-between;
}

.race:hover {
  background: var(--bg-hover);
}

/* A race's ships sit one step in from the race row above them. Declared last, after
   `.shiprow` and `.nested`, so it wins the cascade for the rows it applies to. */
.shiprow.in-race {
  padding-left: 36px;
}

.nested.deep {
  padding-left: 56px;
}

/* ---- narrow windows: touch-sized rows ------------------------------------------------- */
@media (max-width: 1040px) {
  .search input {
    font-size: 16px;
    min-height: 40px;
    padding: 6px 10px;
  }

  .esi {
    min-height: 44px;
    font-size: 14px;
    margin: 0 8px 8px;
  }

  .header {
    padding: 8px 6px 4px;
  }

  .group,
  .race {
    min-height: 44px;
    padding-top: 10px;
    padding-bottom: 10px;
    font-size: 14px;
  }

  .shiprow {
    min-height: 44px;
    padding-top: 8px;
    padding-bottom: 8px;
    font-size: 14px;
  }

  .shiprow img {
    width: 30px;
    height: 30px;
  }

  /* The caret is its own tap target; give it enough room to hit reliably */
  .caret {
    width: 28px;
    font-size: 13px;
  }

  .shipdetail {
    padding: 10px;
  }

  .newfit {
    min-height: 44px;
    font-size: 15px;
  }

  .fitrow {
    min-height: 44px;
    padding-top: 10px;
    padding-bottom: 10px;
    font-size: 14px;
  }
}
</style>
