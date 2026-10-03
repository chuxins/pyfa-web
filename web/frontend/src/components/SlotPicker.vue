<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { api, imageUrl, Item } from '@/api'
import { useFittingStore } from '@/stores/fitting'
import { useBrowserStore } from '@/stores/browser'
import { t } from '@/i18n'

/**
 * The mobile "pick a module for this slot" sheet: the slot's modules come up right
 * away, the search box narrows that same rack, and tapping a row fits it into the
 * slot the sheet was opened from (`replaceLocalModule` at that position, which fills
 * an empty slot and swaps a filled one). The rack is laid out as one card per module
 * group, every card folded until the pilot opens it, so a long rack is scannable at a
 * glance.
 */
const props = defineProps<{ slot: string; position: number; label: string }>()
const emit = defineEmits<{ close: [] }>()

const fitting = useFittingStore()
const browser = useBrowserStore()

const query = ref('')
/** The size class the list is narrowed to (1 small .. 4 extra large), or null for all sizes. */
const size = ref<number | null>(null)
const results = ref<Item[]>([])
const searching = ref(false)
const error = ref('')

/** The size chips, in the order the filter row draws them; `null` means "all sizes". */
const SIZES = [null, 1, 2, 3, 4] as const
const SIZE_LABELS: Record<number, string> = { 1: 'Small', 2: 'Medium', 3: 'Large', 4: 'Extra large' }

function setSize(option: number | null) {
  size.value = option
}

/** One card of the list: a module group, folded shut until the pilot opens it. */
interface GroupCard {
  group: string
  items: Item[]
}

//: The groups the pilot has opened; the sheet starts with every card folded
const openGroups = reactive(new Set<string>())

/** The results split into cards, one per module group, ordered by group name. */
const groups = computed<GroupCard[]>(() => {
  const byGroup = new Map<string, Item[]>()
  for (const item of results.value) {
    const key = item.group ?? ''
    let list = byGroup.get(key)
    if (!list) {
      list = []
      byGroup.set(key, list)
    }
    list.push(item)
  }
  return [...byGroup.entries()]
    .map(([group, items]) => ({ group, items }))
    .sort((a, b) => a.group.localeCompare(b.group))
})

/** Fold or unfold one card; the choice lasts while the sheet is open. */
function toggle(group: string) {
  if (openGroups.has(group)) openGroups.delete(group)
  else openGroups.add(group)
}

/** One query: a browse of the slot's modules (empty text) or a name search in that rack.
 * The list is the modules the current fit's ship can take: the server filters the rack
 * by the fit's hull, so a Rifter never offers a module only a dreadnought can fit. The
 * results come back as group cards, folded until the pilot opens one. */
async function search(text: string) {
  searching.value = true
  error.value = ''
  try {
    const { results: found } = await api.searchItems(text, props.slot, fitting.fit?.id, 1000, size.value ?? undefined)
    results.value = found
  } catch (err) {
    results.value = []
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    searching.value = false
  }
}

watch(query, (value) => search(value.trim()))
// A size chip narrows the same rack, so the list is read again
watch(size, () => search(query.value.trim()))
// The first screen is the slot's modules, before the pilot types anything
void search('')
// If the fit (and with it the ship) changes while the sheet is open, the list follows
watch(() => fitting.fit?.id, () => search(query.value.trim()))

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
      <span v-else class="dim">{{ t('{count} groups', { count: groups.length }) }}</span>
    </div>

    <div class="sizerow">
      <button
        v-for="option in SIZES"
        :key="option ?? 0"
        class="chip"
        :class="{ active: size === option }"
        @click="setSize(option)"
      >
        {{ option === null ? t('All sizes') : t(SIZE_LABELS[option]) }}
      </button>
    </div>

    <div class="fitnote dim">{{ t('only modules that fit this ship are shown') }}</div>

    <div class="list">
      <section v-for="card in groups" :key="card.group" class="card">
        <button
          class="cardhead"
          :aria-expanded="openGroups.has(card.group)"
          @click="toggle(card.group)"
        >
          <span class="chevron" :class="{ open: openGroups.has(card.group) }" aria-hidden="true">▸</span>
          <span class="cardname">{{ card.group }}</span>
          <span class="dim count">{{ card.items.length }}</span>
        </button>
        <div v-if="openGroups.has(card.group)" class="cardbody">
          <button
            v-for="item in card.items"
            :key="item.id"
            class="row"
            :disabled="fitting.busy"
            @click="pick(item)"
          >
            <img v-if="item.image" :src="imageUrl(item.image, 1)!" alt="" loading="lazy" />
            <span class="name">{{ item.name }}</span>
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
  grid-template-rows: auto auto auto auto 1fr;
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

.sizerow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.chip {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 10px;
  background: none;
}

.chip.active {
  background: var(--accent-dim);
  color: var(--accent);
  border-color: var(--accent);
}

.fitnote {
  padding: 0 10px 6px;
  font-size: 11px;
}

.list {
  overflow-y: auto;
  padding: 4px 6px 16px;
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

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card {
  border: 1px solid var(--border);
  border-radius: 4px;
  margin: 4px 0;
  overflow: hidden;
  background: var(--bg-panel);
}

.cardhead {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 8px 10px;
  font-weight: 600;
}

.cardhead:active {
  background: var(--bg-hover);
}

.chevron {
  display: inline-block;
  width: 10px;
  font-size: 11px;
  color: var(--text-dim);
  transition: transform 120ms ease;
}

.chevron.open {
  transform: rotate(90deg);
}

.cardname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  font-weight: 400;
}

.cardbody {
  border-top: 1px solid var(--border);
  padding: 2px;
}

.empty {
  padding: 12px 4px;
  font-size: 12px;
}

.error {
  color: var(--danger);
}
</style>
