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

/** Results grouped by module type, in first-seen order. */
const groups = computed(() => {
  const byName = new Map<string, Item[]>()
  for (const item of results.value) {
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

/** One query: a browse of the slot's modules (empty text) or a name search in that rack. */
async function search(text: string) {
  searching.value = true
  error.value = ''
  try {
    const { results: found } = await api.searchItems(text, props.slot, fitting.fit?.id)
    results.value = found
    // Browsing (empty text) comes up grouped and folded; a search unfolds every match.
    const names = [...new Set(found.map((item) => item.group ?? ''))]
    collapsed.value = new Set(text.trim() ? [] : names)
  } catch (err) {
    results.value = []
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    searching.value = false
  }
}

watch(query, (value) => search(value.trim()))
// The first screen is the slot's modules, before the pilot types anything
void search('')

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
      <span v-else class="dim">{{ t('{count} results', { count: results.length }) }}</span>
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
        {{ t('no modules match your search') }}
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
  grid-template-rows: auto auto 1fr;
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
