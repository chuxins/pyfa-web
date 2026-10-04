<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { api, GraphAxis, GraphMeta, GraphPlot, GraphTarget } from '@/api'
import { errorText } from '@/errors'
import { t } from '@/i18n'
import { useFittingStore } from '@/stores/fitting'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const fitting = useFittingStore()

const graphs = ref<GraphMeta[]>([])
const targets = ref<GraphTarget[]>([])
const defaultTarget = ref<GraphTarget | null>(null)
const graphId = ref('')
const xKey = ref('')
const yKey = ref('')
const range = ref<[number, number] | null>(null)
const rangeEdited = ref(false)
const misc = ref<Record<string, string>>({})
const checkboxes = ref<Record<string, boolean>>({})
const vectors = ref<Record<string, string>>({})
const tgt = ref('')
const ammoStyle = ref<'none' | 'pattern' | 'color'>('color')
const ammoQuality = ref<'all' | 'navy' | 't1'>('navy')
const plot = ref<GraphPlot | null>(null)
const error = ref('')
const loading = ref(false)

const graph = computed(() => graphs.value.find((g) => g.id === graphId.value) ?? null)
const xDef = computed(() => graph.value?.xDefs.find((d) => axisKey(d) === xKey.value) ?? null)

function axisKey(axis: GraphAxis): string {
  return axis.unit ? `${axis.handle}:${axis.unit}` : `${axis.handle}:`
}

function axisTitle(axis?: GraphAxis): string {
  if (!axis) return ''
  return axis.unit ? `${axis.label} (${axis.unit})` : axis.label
}

/** The range input that drives the chosen x axis (mirrors ``view.inputMap``). */
const mainInputDef = computed(() => {
  const g = graph.value
  const x = xDef.value
  if (!g || !x?.mainInput) return null
  return g.inputs.find((i) => i.handle === x.mainInput![0] && i.unit === x.mainInput![1]) ?? null
})

/** Same visibility rule as the desktop's input conditions. */
function conditionsOk(conditions: ([string, string] | null)[][]): boolean {
  if (!conditions || conditions.length === 0) return true
  for (const [xc, yc] of conditions) {
    let xok = true
    let yok = true
    if (xc) xok = xKey.value === `${xc[0]}:${xc[1]}`
    if (yc) yok = yKey.value === `${yc[0]}:${yc[1]}`
    if (xok && yok) return true
  }
  return false
}

const visibleInputs = computed(() => {
  const g = graph.value
  if (!g) return []
  const main = mainInputDef.value
  return g.inputs.filter((i) => i.handle !== main?.handle && conditionsOk(i.conditions))
})

const visibleCheckboxes = computed(() => {
  const g = graph.value
  if (!g) return []
  return g.checkboxes.filter((c) => conditionsOk(c.conditions))
})

/** The attacker/target vector fields as plain number inputs (length + angle). */
const vectorDefs = computed(() => {
  const g = graph.value
  if (!g) return []
  const defs: { handle: string; label: string }[] = []
  for (const v of [g.srcVector, g.tgtVector]) {
    if (!v) continue
    if (v.lengthHandle !== mainInputDef.value?.handle) {
      defs.push({ handle: v.lengthHandle, label: `${v.label} (${v.lengthUnit})` })
    }
    defs.push({ handle: v.angleHandle, label: `${v.label} angle (°)` })
  }
  return defs
})

// -- fetching ----------------------------------------------------------------

let timer: number | undefined
let seq = 0

async function loadPlot() {
  const g = graph.value
  const fit = fitting.fit
  if (!g || !fit || !xKey.value || !yKey.value) return
  const mySeq = ++seq
  loading.value = true
  error.value = ''
  const params: Record<string, string> = { x: xKey.value, y: yKey.value }
  if (rangeEdited.value && range.value) params.range = `${range.value[0]},${range.value[1]}`
  const miscEntries = Object.entries(misc.value).filter(([, v]) => v !== '')
  if (miscEntries.length) params.inputs = JSON.stringify(Object.fromEntries(miscEntries.map(([k, v]) => [k, Number(v)])))
  const chk = Object.entries(checkboxes.value).filter(([, v]) => Boolean(v))
  if (chk.length) params.checkboxes = JSON.stringify(Object.fromEntries(chk))
  const vec = Object.entries(vectors.value).filter(([, v]) => v !== '')
  if (vec.length) params.vectors = JSON.stringify(Object.fromEntries(vec.map(([k, v]) => [k, Number(v)])))
  if (tgt.value) params.tgt = tgt.value
  if (g.hasSegments) {
    params.ammoStyle = ammoStyle.value
    params.ammoQuality = ammoQuality.value
  }
  try {
    const data = await api.graphPlot(fit.id, g.id, params)
    if (mySeq !== seq) return
    plot.value = data
    if (!rangeEdited.value && data.range) range.value = data.range
  } catch (e) {
    if (mySeq !== seq) return
    error.value = errorText(e)
    plot.value = null
  } finally {
    if (mySeq === seq) loading.value = false
  }
}

function schedule() {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(loadPlot, 250)
}

function resetControls(g: GraphMeta) {
  range.value = null
  rangeEdited.value = false
  misc.value = {}
  checkboxes.value = {}
  vectors.value = {}
  const defaults: Record<string, string> = {}
  for (const v of [g.srcVector, g.tgtVector]) {
    if (v) {
      defaults[v.lengthHandle] = '100'
      defaults[v.angleHandle] = '0'
    }
  }
  vectors.value = defaults
}

async function loadList() {
  const fit = fitting.fit
  if (!fit) return
  try {
    const list = await api.graphList(fit.id)
    graphs.value = list.graphs
    targets.value = list.targets
    defaultTarget.value = list.defaultTarget
    const g = list.graphs[0]
    if (g) {
      graphId.value = g.id
      xKey.value = axisKey(g.xDefs[0])
      yKey.value = axisKey(g.yDefs[0])
      tgt.value = g.hasTargets ? `${list.defaultTarget.type}:${list.defaultTarget.id}` : ''
      resetControls(g)
      loadPlot()
    }
  } catch (e) {
    error.value = errorText(e)
  }
}

watch(graphId, (id) => {
  const g = graphs.value.find((x) => x.id === id)
  if (!g) return
  xKey.value = axisKey(g.xDefs[0])
  yKey.value = axisKey(g.yDefs[0])
  tgt.value = g.hasTargets && defaultTarget.value ? `${defaultTarget.value.type}:${defaultTarget.value.id}` : ''
  resetControls(g)
  schedule()
})

watch(xKey, () => {
  // The main input (and the inputs visible) follow the chosen x axis
  range.value = null
  rangeEdited.value = false
  misc.value = {}
  schedule()
})

watch([yKey, misc, checkboxes, vectors, tgt, ammoStyle, ammoQuality], schedule)

watch(
  () => fitting.fit?.id,
  async (id, oldId) => {
    if (!id) {
      graphs.value = []
      plot.value = null
      return
    }
    if (id !== oldId) await loadList()
    else schedule() // the same fit was edited: redraw the curves
  },
)

onMounted(() => {
  if (fitting.fit) loadList()
  renderChart()
  themeQuery = window.matchMedia('(prefers-color-scheme: light)')
  themeQuery.addEventListener('change', renderChart)
  if (chartEl.value) resizeObserver.observe(chartEl.value)
})

onBeforeUnmount(() => {
  themeQuery?.removeEventListener('change', renderChart)
  resizeObserver.disconnect()
  if (timer) window.clearTimeout(timer)
  chart?.dispose()
  chart = null
})

// -- chart -------------------------------------------------------------------

const chartEl = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let themeQuery: MediaQueryList | null = null
const resizeObserver = new ResizeObserver(() => chart?.resize())

function themeColors() {
  const style = getComputedStyle(document.documentElement)
  return {
    text: style.getPropertyValue('--text').trim() || '#dfe4ec',
    border: style.getPropertyValue('--border').trim() || '#2c333f',
  }
}

function renderChart() {
  if (!chartEl.value) return
  if (!chart) chart = echarts.init(chartEl.value)
  const { text, border } = themeColors()
  const multi = (plot.value?.series.length ?? 0) > 1
  const series = (plot.value?.series ?? []).map((s) => ({
    name: s.name,
    type: 'line',
    showSymbol: false,
    animation: false,
    sampling: 'lttb',
    lineStyle: { color: s.color, width: 2, type: s.lineType },
    itemStyle: { color: s.color },
    emphasis: { lineStyle: { width: 3 } },
    data: s.points,
  }))
  chart.setOption(
    {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: { trigger: 'axis' },
      legend: { show: multi, top: 0, textStyle: { color: text }, itemWidth: 14, itemHeight: 8 },
      grid: { left: 8, right: 8, top: multi ? 26 : 10, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value',
        name: axisTitle(plot.value?.x),
        nameTextStyle: { color: text },
        axisLabel: { color: text },
        axisLine: { lineStyle: { color: border } },
        splitLine: { lineStyle: { color: border } },
      },
      yAxis: {
        type: 'value',
        name: axisTitle(plot.value?.y),
        nameTextStyle: { color: text },
        axisLabel: { color: text },
        axisLine: { lineStyle: { color: border } },
        splitLine: { lineStyle: { color: border } },
      },
      series,
    },
    { notMerge: true },
  )
}

watch(plot, renderChart)

// -- input handlers ----------------------------------------------------------

function onRangeLow(event: Event) {
  const v = Number((event.target as HTMLInputElement).value)
  const high = range.value?.[1] ?? 0
  range.value = [Number.isFinite(v) ? v : high, high]
  rangeEdited.value = true
  schedule()
}

function onRangeHigh(event: Event) {
  const v = Number((event.target as HTMLInputElement).value)
  const low = range.value?.[0] ?? 0
  range.value = [low, Number.isFinite(v) ? v : low]
  rangeEdited.value = true
  schedule()
}

function onMiscChange(handle: string, event: Event) {
  misc.value = { ...misc.value, [handle]: (event.target as HTMLInputElement).value }
  schedule()
}

function onVectorChange(handle: string, event: Event) {
  vectors.value = { ...vectors.value, [handle]: (event.target as HTMLInputElement).value }
  schedule()
}

function onCheckboxChange(handle: string, event: Event) {
  checkboxes.value = { ...checkboxes.value, [handle]: (event.target as HTMLInputElement).checked }
  schedule()
}
</script>

<template>
  <div class="graphs">
    <div v-if="error" class="gerror">{{ error }}</div>

    <template v-if="graphs.length">
      <div class="grow">
        <label class="gselect">
          <span class="dim">{{ t('Graph') }}</span>
          <select v-model="graphId">
            <option v-for="g in graphs" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </label>
        <label v-if="graph && !graph.hasSegments && graph.xDefs.length > 1" class="gselect">
          <span class="dim">{{ t('X axis') }}</span>
          <select v-model="xKey">
            <option v-for="d in graph.xDefs" :key="axisKey(d)" :value="axisKey(d)">{{ d.label }}</option>
          </select>
        </label>
        <label v-if="graph && graph.yDefs.length > 1" class="gselect">
          <span class="dim">{{ t('Y axis') }}</span>
          <select v-model="yKey">
            <option v-for="d in graph.yDefs" :key="axisKey(d)" :value="axisKey(d)">{{ d.label }}</option>
          </select>
        </label>
        <label v-if="graph?.hasTargets" class="gselect">
          <span class="dim">{{ t('Target') }}</span>
          <select v-model="tgt">
            <option v-for="target in targets" :key="`${target.type}:${target.id}`" :value="`${target.type}:${target.id}`">
              {{ target.name }}
            </option>
          </select>
        </label>
      </div>

      <div class="grow">
        <template v-if="graph?.hasSegments">
          <label class="gselect">
            <span class="dim">{{ t('Ammo style') }}</span>
            <select v-model="ammoStyle">
              <option value="color">{{ t('Color') }}</option>
              <option value="pattern">{{ t('Pattern') }}</option>
              <option value="none">{{ t('None') }}</option>
            </select>
          </label>
          <label class="gselect">
            <span class="dim">{{ t('Ammo quality') }}</span>
            <select v-model="ammoQuality">
              <option value="all">{{ t('All') }}</option>
              <option value="navy">{{ t('Navy') }}</option>
              <option value="t1">{{ t('T1') }}</option>
            </select>
          </label>
        </template>

        <label v-if="mainInputDef && conditionsOk(mainInputDef.conditions)" class="gselect range">
          <span class="dim">{{ mainInputDef.label }}</span>
          <input type="number" :value="range?.[0]" @change="onRangeLow" />
          <span class="dim">–</span>
          <input type="number" :value="range?.[1]" @change="onRangeHigh" />
        </label>

        <label v-for="input in visibleInputs" :key="input.handle" class="gselect">
          <span class="dim">{{ input.label }}</span>
          <input
            type="number"
            :value="misc[input.handle] ?? ''"
            :placeholder="input.defaultValue == null ? t('auto') : String(input.defaultValue)"
            @change="onMiscChange(input.handle, $event)"
          />
        </label>

        <label v-for="vector in vectorDefs" :key="vector.handle" class="gselect">
          <span class="dim">{{ vector.label }}</span>
          <input type="number" :value="vectors[vector.handle] ?? ''" @change="onVectorChange(vector.handle, $event)" />
        </label>

        <label v-for="checkbox in visibleCheckboxes" :key="checkbox.handle" class="gcheck">
          <input
            type="checkbox"
            :checked="checkboxes[checkbox.handle] ?? checkbox.defaultValue"
            @change="onCheckboxChange(checkbox.handle, $event)"
          />
          <span>{{ checkbox.label }}</span>
        </label>
      </div>

      <div ref="chartEl" class="chart" :class="{ dim: loading }" />
      <div v-if="!loading && plot && plot.series.length === 0" class="dim pad">{{ t('No data to draw') }}</div>
      <div v-if="!loading && plot?.warning" class="dim pad">{{ t(plot.warning) }}</div>
    </template>

    <div v-else-if="!loading" class="dim pad">{{ t('No fit open') }}</div>
  </div>
</template>

<style scoped>
.graphs {
  padding: 8px;
  display: grid;
  gap: 8px;
}

.grow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  align-items: center;
}

.gselect {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.gselect input {
  width: 64px;
}

.gselect.range input {
  width: 52px;
}

.gcheck {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.chart {
  height: 280px;
  min-height: 280px;
}

.pad {
  padding: 6px 2px;
}

.gerror {
  color: var(--danger);
  font-size: 12px;
  padding: 4px 2px;
}
</style>
