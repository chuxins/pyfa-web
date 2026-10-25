<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, imageUrl, Item } from '@/api'
import { useFittingStore } from '@/stores/fitting'
import { useBrowserStore } from '@/stores/browser'
import { t } from '@/i18n'

/**
 * The mobile "pick a module for this slot" sheet: the slot's modules come up right
 * away, narrowed to what the fit's ship can take (slot, hull rule and weapon size are
 * filtered on the server), the search box narrows that same list, and tapping a row
 * fits it into the slot the sheet was opened from -- `replaceLocalModule` at that
 * position fills an empty slot and swaps a filled one.
 *
 * The results are grouped into foldable cards by module type (group). Browsing the
 * rack comes up with every card folded so the screen reads as a short list of module
 * types; typing a search unfolds the groups that matched.
 */
const props = defineProps<{ slot: string; position: number; label: string }>()
const emit = defineEmits<{ close: [] }>()

const fitting = useFittingStore()
const browser = useBrowserStore()

const query = ref('')
const results = ref<Item[]>([])
const searching = ref(false)
const error = ref('')
/** Group names that are folded away; everything else shows its modules. */
const collapsed = ref<Set<string>>(new Set())

/** Size chips: 0 means every size; 1..4 are small..extra large. A rig's own size
 * (1..3) counts too, and a module with no size concept only shows under "every size". */
const SIZE_FILTERS = [
  { value: 0, label: 'All sizes' },
  { value: 1, label: 'Small' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Large' },
  { value: 4, label: 'Extra Large' },
]
const sizeFilter = ref(0)
/** Only list modules the ship can take (server-side); off browses the whole rack. */
const availableOnly = ref(true)

/** The server's answer, narrowed by whichever size chip is on. */
const filtered = computed(() =>
  sizeFilter.value === 0
    ? results.value
    : results.value.filter((item) => item.size === sizeFilter.value),
)

/** Results grouped by module type, in first-seen order. */
const groups = computed(() => {
  const byName = new Map<string, Item[]>()
  for (const item of filtered.value) {
    // The API type allows a null group, though real items always carry one
    const name = item.group ?? ''
    const list = byName.get(name)
    if (list) list.push(item)
    else byName.set(name, [item])
  }
  return [...byName].map(([name, items]) => ({ name, items }))
})

function isCollapsed(name: string) {
  return collapsed.value.has(name)
}

function toggleGroup(name: string) {
  const next = new Set(collapsed.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  collapsed.value = next
}

/** Browsing (empty text) comes up grouped and folded; a search unfolds every match. */
function applyFoldDefaults(text: string, list: Item[]) {
  const names = [...new Set(list.map((item) => item.group ?? ''))]
  collapsed.value = new Set(text.trim() ? [] : names)
}

/** One query: a browse of the slot's modules (empty text) or a name search in that rack. */
async function search(text: string) {
  searching.value = true
  error.value = ''
  try {
    // With "only what this ship can fit" on, the server narrows the rack to what the
    // hull takes; off, the whole rack comes back and the size chips alone decide what
    // is drawn. A browse asks for the whole rack so the foldable type cards cover it.
    const fitId = availableOnly.value ? fitting.fit?.id : undefined
    const { results: found } = await api.searchItems(text, props.slot, fitId, 1000)
    results.value = found
    applyFoldDefaults(text, found)
  } catch (err) {
    results.value = []
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    searching.value = false
  }
}

watch(query, (value) => search(value.trim()))
// Toggling "only what this ship can fit" re-asks the server with or without the fit
watch(availableOnly, () => search(query.value.trim()))
// A size chip only changes which fetched groups are drawn, not what was fetched
watch(sizeFilter, () => applyFoldDefaults(query.value.trim(), filtered.value))
// The first screen is the slot's modules, before the pilot types anything
void search('')

const emptyText = computed(() =>
  query.value.trim()
    ? t('no modules match your search')
    : t('no modules match these filters'),
)

async function pick(item: Item) {
  if (fitting.busy) return
  const fit = await fitting.send('replaceLocalModule', {
    itemId: item.id,
    positions: [props.position],
  })
  if (fit) {
    await browser.refreshShipFits()
    emit('close')
  }
}
</script>

<template>
  <div class="slotpicker">
    <div class="head">
      <span class="title">{{ t('Pick a module for the {rack}', { rack: props.label }) }}</span>
      <button class="close" :title="t('Close')" @click="emit('close')">&times;</button>
    </div>

    <div class="searchbar">
      <input
        v-model="query"
        :placeholder="t('Search {rack} modules…', { rack: props.label })"
        spellcheck="false"
      />
      <span v-if="searching" class="dim">{{ t('searching…') }}</span>
      <span v-else-if="error" class="error">{{ error }}</span>
      <span v-else class="dim">{{ t('{count} results', { count: filtered.length }) }}</span>
    </div>

    <div class="filters">
      <button
        v-for="size in SIZE_FILTERS"
        :key="size.value"
        class="chip"
        :class="{ on: sizeFilter === size.value }"
        @click="sizeFilter = size.value"
      >{{ t(size.label) }}</button>
      <span class="filtersep" />
      <button
        class="chip avail"
        :class="{ on: availableOnly }"
        @click="availableOnly = !availableOnly"
      >{{ t('Only what this ship can fit') }}</button>
    </div>

    <div class="list">
      <section v-for="group in groups" :key="group.name" class="groupcard">
        <button class="grouptitle" @click="toggleGroup(group.name)">
          <span class="caret" :class="{ open: !isCollapsed(group.name) }">&#9656;</span>
          <span class="gname">{{ group.name }}</span>
          <span class="count dim">{{ group.items.length }}</span>
        </button>
        <div v-if="!isCollapsed(group.name)" class="gitems">
          <button
            v-for="item in group.items"
            :key="item.id"
            class="row"
            :disabled="fitting.busy"
            @click="pick(item)"
          >
            <img v-if="item.image" :src="imageUrl(item.image, 1)!" alt="" loading="lazy" />
            <span v-else class="icon placeholder" />
            <span class="namewrap">
              <span class="name">{{ item.name }}</span>
              <span class="dim meta">{{ item.group }}</span>
            </span>
          </button>
        </div>
      </section>
      <div v-if="!groups.length && !searching && !error" class="dim empty">
        {{ emptyText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.slotpicker {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: var(--bg);
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  min-height: 0;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.title {
  flex: 1;
  font-weight: 600;
}

.close {
  padding: 0 7px;
}

.searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
}

.searchbar input {
  flex: 1;
  min-width: 0;
}

/* One horizontal strip: the size chips, a divider, then the "this ship" toggle. */
.filters {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: none;
}

.chip {
  flex: none;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
}

.chip.on {
  color: var(--accent);
  border-color: var(--accent);
}

.filtersep {
  flex: none;
  width: 1px;
  height: 14px;
  margin: 0 2px;
  background: var(--border);
}

.list {
  overflow-y: auto;
  padding: 6px 6px 16px;
}

/* One foldable card per module type */
.groupcard {
  border: 1px solid var(--border);
  border-radius: 5px;
  overflow: hidden;
  background: var(--bg-panel);
  margin: 0 2px 6px;
}

.grouptitle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 0;
  padding: 8px 10px;
  min-height: 40px;
}

.caret {
  display: inline-block;
  width: 8px;
  flex: none;
  color: var(--text-dim);
  font-size: 11px;
  transition: transform 0.12s ease;
}

.caret.open {
  transform: rotate(90deg);
}

/* The module type sits right behind the caret, ahead of the count, and keeps at
   least three characters visible even when the card is squeezed. */
.gname {
  flex: 0 1 auto;
  min-width: 3em;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  margin-left: auto;
  flex: none;
  font-size: 11px;
}

.gitems {
  border-top: 1px solid var(--border);
  padding: 4px 6px;
}

.row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 3px;
  padding: 4px;
}

.row:active {
  background: var(--bg-hover);
}

.row img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.icon.placeholder {
  display: inline-block;
}

/* Name first, then the module type right after it (not pinned to the row's far
   edge), so the type is never squeezed off screen -- it keeps at least three
   characters and the name does the truncating. */
.namewrap {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  flex: 0 1 auto;
  min-width: 3em;
  max-width: 50%;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  padding: 12px 6px;
  text-align: center;
}
</style>
