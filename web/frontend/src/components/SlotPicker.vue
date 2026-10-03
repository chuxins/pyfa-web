<script setup lang="ts">
import { ref, watch } from 'vue'
import { api, imageUrl, Item } from '@/api'
import { useFittingStore } from '@/stores/fitting'
import { useBrowserStore } from '@/stores/browser'
import { t } from '@/i18n'

/**
 * The mobile "pick a module for this slot" sheet: the slot's modules come up right
 * away, the search box narrows that same rack, and tapping a row fits it into the
 * slot the sheet was opened from (`replaceLocalModule` at that position, which fills
 * an empty slot and swaps a filled one).
 */
const props = defineProps<{ slot: string; position: number; label: string }>()
const emit = defineEmits<{ close: [] }>()

const fitting = useFittingStore()
const browser = useBrowserStore()

const query = ref('')
const results = ref<Item[]>([])
const searching = ref(false)
const error = ref('')

/** One query: a browse of the slot's modules (empty text) or a name search in that rack. */
async function search(text: string) {
  searching.value = true
  error.value = ''
  try {
    const { results: found } = await api.searchItems(text, props.slot)
    results.value = found
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
      <button v-for="item in results" :key="item.id" class="row" :disabled="fitting.busy" @click="pick(item)">
        <img v-if="item.image" :src="imageUrl(item.image, 1)!" alt="" loading="lazy" />
        <span class="name">{{ item.name }}</span>
        <span class="dim meta">{{ item.group }}</span>
      </button>
      <div v-if="!results.length && !searching && !error" class="dim empty">
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
  padding: 4px 6px 16px;
}

.row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
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

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40vw;
}

.empty {
  padding: 12px 4px;
  font-size: 12px;
}

.error {
  color: var(--danger);
}
</style>
