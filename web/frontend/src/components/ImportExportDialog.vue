<script setup lang="ts">
/**
 * Fit text import/export and XML backup (M1, web/docs/full-port-design.md §3.3).
 *
 * Three tabs: importing pasted or uploaded text (as new fits, or applied to the
 * open fit -- the desktop paste semantics), exporting the open fit in the
 * desktop's text formats (download or clipboard), and the XML backup round trip.
 * Everything goes through the port store, the only place the endpoints are
 * touched.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ExportFormat } from '@/api'
import { t } from '@/i18n'
import { useFittingStore } from '@/stores/fitting'
import { usePortStore } from '@/stores/port'

const emit = defineEmits<{ close: [] }>()

const port = usePortStore()
const fitting = useFittingStore()

/** Which tab is on screen. */
type Tab = 'import' | 'export' | 'backup'
const tab = ref<Tab>('import')

// ---- Import tab ------------------------------------------------------------

const importText = ref('')
/** Item-level text (mutated module, drones, ...) goes into the open fit instead of a new row. */
const applyToFit = ref(false)
const importFile = ref<HTMLInputElement | null>(null)

async function onImportFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importText.value = await file.text()
  ;(event.target as HTMLInputElement).value = ''
}

function canImport() {
  return port.busy || !importText.value.trim() || (applyToFit.value && !fitting.fit)
}

async function doImport() {
  if (canImport()) return
  const targetFitId = applyToFit.value && fitting.fit ? fitting.fit.id : null
  await port.importText(importText.value, targetFitId)
}

// ---- Export tab ------------------------------------------------------------

interface FormatOption {
  /** The option's key in the export request body */
  key: 'charges' | 'implants' | 'boosters' | 'cargo' | 'formatting'
  /** The desktop copySelectDialog's label; translated where it is shown */
  label: string
}

interface ExportFormatDef {
  format: ExportFormat
  label: string
  options: FormatOption[]
}

/**
 * The formats and their options, in the desktop copySelectDialog's order.
 * `optimizePrices` is left out: the server refuses it until the P2 price work,
 * so ticking it would only ever fail. `formatting` belongs to DNA only.
 */
const EXPORT_FORMATS: ExportFormatDef[] = [
  {
    format: 'eft',
    label: 'EFT',
    options: [
      { key: 'charges', label: 'Loaded charges' },
      { key: 'implants', label: 'Implants' },
      { key: 'boosters', label: 'Boosters' },
      { key: 'cargo', label: 'Cargo' },
    ],
  },
  { format: 'dna', label: 'DNA', options: [{ key: 'formatting', label: 'Formatting tags' }] },
  {
    format: 'multibuy',
    label: 'Multibuy',
    options: [
      { key: 'charges', label: 'Loaded charges' },
      { key: 'implants', label: 'Implants' },
      { key: 'boosters', label: 'Boosters' },
      { key: 'cargo', label: 'Cargo' },
    ],
  },
  { format: 'shipstats', label: 'Ship stats', options: [] },
  { format: 'efs', label: 'EFS JSON', options: [] },
  { format: 'esiJson', label: 'ESI JSON', options: [] },
]

const exportFormat = ref<ExportFormat>('eft')
const exportOptions = ref<Record<string, boolean>>({
  charges: true,
  implants: false,
  boosters: false,
  cargo: true,
  formatting: true,
})

const currentOptions = computed(
  () => EXPORT_FORMATS.find((entry) => entry.format === exportFormat.value)?.options ?? [],
)

/** Only the options the chosen format offers, so a hidden box cannot send a stray key. */
function exportPayload(): Record<string, boolean> {
  const payload: Record<string, boolean> = {}
  for (const option of currentOptions.value) payload[option.key] = exportOptions.value[option.key] ?? true
  return payload
}

/** Give the browser a file to save, named the way the server named it. */
function saveFile(file: { filename: string; contentType: string; text: string }) {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.contentType }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  port.showNotice(t('Downloaded {filename}', { filename: file.filename }))
}

async function download() {
  if (!fitting.fit || port.busy) return
  const file = await port.exportFit(fitting.fit.id, exportFormat.value, exportPayload())
  if (file) saveFile(file)
}

async function copy() {
  if (!fitting.fit || port.busy) return
  const file = await port.exportFit(fitting.fit.id, exportFormat.value, exportPayload())
  if (!file) return
  try {
    await navigator.clipboard.writeText(file.text)
    port.showNotice(t('Copied to clipboard'))
  } catch {
    port.setError(new Error(t('Could not copy to the clipboard')))
  }
}

// ---- Backup tab ------------------------------------------------------------

const backupText = ref('')
const backupFile = ref<HTMLInputElement | null>(null)

async function onBackupFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  backupText.value = await file.text()
  ;(event.target as HTMLInputElement).value = ''
}

async function downloadBackup() {
  if (port.busy) return
  const file = await port.exportBackup()
  if (file) saveFile(file)
}

async function restoreBackup() {
  if (port.busy || !backupText.value.trim()) return
  await port.importBackup(backupText.value)
}

// ---- Shared ----------------------------------------------------------------

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  // A fresh dialog has nothing to report; the previous session's result belongs
  // to the screen that was open before this one.
  port.lastImport = null
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <header class="head">
        <h2>{{ t('Import/Export') }}</h2>
        <button class="close" :title="t('Close')" @click="emit('close')">✕</button>
      </header>

      <nav class="tabs">
        <button :class="{ active: tab === 'import' }" @click="tab = 'import'">{{ t('Import') }}</button>
        <button :class="{ active: tab === 'export' }" @click="tab = 'export'">{{ t('Export') }}</button>
        <button :class="{ active: tab === 'backup' }" @click="tab = 'backup'">{{ t('Backup') }}</button>
      </nav>

      <p v-if="port.error" class="error">{{ port.error }}</p>
      <p v-if="port.notice" class="notice">{{ port.notice }}</p>

      <!-- Import: pasted or uploaded fit text -->
      <section v-if="tab === 'import'" class="pane">
        <textarea
          v-model="importText"
          rows="8"
          spellcheck="false"
          :placeholder="t('Paste fit text below, or pick a file')"
        />
        <div class="row">
          <button @click="importFile?.click()">{{ t('Pick a file') }}</button>
          <input
            ref="importFile"
            type="file"
            accept=".txt,.xml,.json,text/plain,application/xml,application/json"
            hidden
            @change="onImportFile"
          />
        </div>

        <label class="mode" :class="{ off: !fitting.fit }">
          <input v-model="applyToFit" type="radio" name="importMode" :value="true" :disabled="!fitting.fit" />
          <span>{{ t('Apply to the open fit') }}</span>
        </label>
        <label class="mode">
          <input v-model="applyToFit" type="radio" name="importMode" :value="false" />
          <span>{{ t('Import as new fits') }}</span>
        </label>

        <div class="row actions">
          <button class="primary" :disabled="canImport()" @click="doImport()">
            {{ port.busy ? t('importing…') : t('Import') }}
          </button>
        </div>

        <div v-if="port.lastImport" class="result">
          <p v-if="port.lastImport.appliedToFitId !== null" class="ok">
            {{ t('Imported into the open fit') }}
          </p>
          <template v-else>
            <p class="ok">{{ t('Imported {count} fit(s)', { count: port.lastImport.created.length }) }}</p>
            <ul class="imported">
              <li v-for="fit in port.lastImport.created" :key="fit.id">
                {{ fit.name }}<span class="dim"> · {{ fit.shipName }}</span>
              </li>
            </ul>
          </template>
          <p v-if="port.lastImport.skipped.length" class="dim">
            {{ t('Skipped {count} item(s)', { count: port.lastImport.skipped.length }) }}
          </p>
        </div>
      </section>

      <!-- Export: the open fit as text -->
      <section v-if="tab === 'export'" class="pane">
        <p v-if="!fitting.fit" class="dim hint">{{ t('Open a fit to export it') }}</p>
        <template v-else>
          <label v-for="def in EXPORT_FORMATS" :key="def.format" class="mode">
            <input v-model="exportFormat" type="radio" name="exportFormat" :value="def.format" />
            <span>{{ t(def.label) }}</span>
          </label>
          <div v-if="currentOptions.length" class="options">
            <label v-for="option in currentOptions" :key="option.key" class="check">
              <input v-model="exportOptions[option.key]" type="checkbox" />
              <span>{{ t(option.label) }}</span>
            </label>
          </div>
          <div class="row actions">
            <button :disabled="port.busy" @click="download()">{{ t('Download') }}</button>
            <button :disabled="port.busy" @click="copy()">{{ t('Copy to clipboard') }}</button>
          </div>
        </template>
      </section>

      <!-- Backup: every fit as one XML document -->
      <section v-if="tab === 'backup'" class="pane">
        <div class="row">
          <button :disabled="port.busy" @click="downloadBackup()">{{ t('Export backup') }}</button>
        </div>
        <textarea
          v-model="backupText"
          rows="8"
          spellcheck="false"
          :placeholder="t('Paste the backup XML below, or pick a file')"
        />
        <div class="row">
          <button @click="backupFile?.click()">{{ t('Pick a file') }}</button>
          <input ref="backupFile" type="file" accept=".xml,application/xml" hidden @change="onBackupFile" />
        </div>
        <div class="row actions">
          <button class="primary" :disabled="port.busy || !backupText.trim()" @click="restoreBackup()">
            {{ port.busy ? t('importing…') : t('Restore backup') }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.dialog {
  width: min(30rem, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  overflow: auto;
  padding: 14px 18px 16px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.head .close {
  border: none;
  background: none;
  padding: 0 4px;
  color: var(--text-dim);
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}

.tabs button {
  flex: 1;
  border-color: var(--border);
}

.tabs button.active {
  background: var(--accent-dim);
  border-color: var(--accent);
}

.pane {
  display: grid;
  gap: 10px;
}

.pane textarea {
  width: 100%;
  font: inherit;
  color: var(--text);
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  resize: vertical;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.row.actions {
  margin-top: 2px;
}

.mode {
  display: flex;
  gap: 6px;
  align-items: center;
  cursor: pointer;
}

.mode.off {
  opacity: 0.5;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  padding: 6px 0;
}

.check {
  display: flex;
  gap: 6px;
  align-items: center;
  cursor: pointer;
}

.error {
  color: var(--danger);
  margin: 0 0 10px;
}

.notice {
  color: var(--ok);
  margin: 0 0 10px;
}

.result {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.result p {
  margin: 0 0 4px;
}

.ok {
  color: var(--ok);
}

.imported {
  margin: 0;
  padding-left: 18px;
  max-height: 8rem;
  overflow: auto;
}

.hint {
  margin: 0;
}
</style>

