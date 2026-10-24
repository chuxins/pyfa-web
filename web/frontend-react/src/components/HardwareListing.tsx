import React from "react"
import { Icon, type IconName } from "./Icon"
import { TreeListing, TreeHeader, TreeLeaf } from "./TreeListing"
import { api, type MarketGroup, type MarketTreeItem } from "../api"
import { useFittingStore } from "../store/fitting"
import { useUiStore } from "../store/ui"
import { t } from "../i18n"

interface HardwareFilter {
  low: boolean
  med: boolean
  high: boolean
  rig: boolean
  drone: boolean
}

/**
 * The Hardware tab, eveship.fit's layout. One fetch of the whole market tree
 * (`GET /api/items/market-tree`) hands over every fit item grouped by market
 * group, so the tab draws all equipment up front instead of waiting for a query;
 * the slot filter icons, the search box and the Modules/Charges sub-tabs filter
 * that one tree locally, and the groups remember their collapsed state.
 */
export const HardwareListing = () => {
  const addItem = useFittingStore((state) => state.addItem)
  const setPreview = useUiStore((state) => state.setPreview)

  const [tree, setTree] = React.useState<MarketGroup[] | null>(null)
  const [treeError, setTreeError] = React.useState("")
  const [selection, setSelection] = React.useState<"modules" | "charges">("modules")
  const [filter, setFilter] = React.useState<HardwareFilter>({ low: false, med: false, high: false, rig: false, drone: false })
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    let alive = true
    api.marketTree()
      .then(({ groups }) => {
        if (alive) setTree(groups)
      })
      .catch((error: unknown) => {
        if (alive) setTreeError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
    }
  }, [])

  const searching = query.trim() !== ""

  /** The filtered tree: only groups that still hold a matching item remain. */
  const view = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const anyFilter = filter.low || filter.med || filter.high || filter.rig || filter.drone

    const matches = (item: MarketTreeItem): boolean => {
      if (selection === "charges") {
        if (item.kind !== "charge") return false
      } else {
        if (item.kind === "charge") return false
        if (anyFilter) {
          const slot = item.slotType
          const inLow = slot === "Low" && filter.low
          const inMed = slot === "Medium" && filter.med
          const inHigh = slot === "High" && filter.high
          const inRig = (slot === "Rig" || slot === "SubSystem") && filter.rig
          const inDrone = item.kind === "drone" && filter.drone
          if (!(inLow || inMed || inHigh || inRig || inDrone)) return false
        }
      }
      if (q !== "") {
        if (!item.name.toLowerCase().includes(q) && !item.nameEn.toLowerCase().includes(q)) return false
      }
      return true
    }

    const prune = (group: MarketGroup): MarketGroup | null => {
      const items = group.items.filter(matches)
      const groups: MarketGroup[] = []
      for (const child of group.groups) {
        const node = prune(child)
        if (node !== null) groups.push(node)
      }
      if (items.length === 0 && groups.length === 0) return null
      return { ...group, items, groups }
    }

    const roots: MarketGroup[] = []
    for (const root of tree ?? []) {
      const node = prune(root)
      if (node !== null) roots.push(node)
    }
    return roots
  }, [tree, selection, filter, query])

  const onToggleFilter = (key: keyof HardwareFilter) => {
    setFilter({ ...filter, [key]: !filter[key] })
  }

  const onToggleGroup = (key: string, next: boolean) => {
    setOpen((current) => ({ ...current, [key]: next }))
  }

  /** Root groups start expanded so the structure is visible; search forces all open. */
  const isOpen = (key: string, level: number): boolean => {
    if (searching) return true
    return open[key] ?? (level === 1)
  }

  const onDragStart = (e: React.DragEvent<HTMLDivElement>, item: MarketTreeItem) => {
    e.dataTransfer.setData("application/esf-type-id", item.id.toString())
    e.dataTransfer.setData("application/esf-kind", item.kind)
    if (item.slotType) e.dataTransfer.setData("application/esf-slot-type", item.slotType)
    try {
      const img = new Image()
      img.src = `https://images.evetech.net/types/${item.id}/icon?size=64`
      e.dataTransfer.setDragImage(img, 32, 32)
    } catch {
      // ignore
    }
  }

  const onHover = (item: MarketTreeItem) => {
    if (item.kind !== "module") {
      setPreview(null)
      return
    }
    setPreview({ itemId: item.id, slotType: item.slotType ?? "High", kind: "module" })
  }

  const renderGroup = (group: MarketGroup, path: string, level: number) => {
    const key = path
    const expanded = isOpen(key, level)
    return (
      <TreeListing
        key={key}
        level={level}
        header={<TreeHeader text={group.name} />}
        expanded={expanded}
        onToggle={(next) => onToggleGroup(key, next)}
        getChildren={() => (
          <>
            {group.items.map((item) => (
              <TreeLeaf
                key={item.id}
                level={level + 1}
                content={item.name}
                onDoubleClick={() => void addItem({ id: item.id, itemKind: item.kind })}
                onDragStart={(e) => onDragStart(e, item)}
                onMouseEnter={() => onHover(item)}
                onMouseLeave={() => setPreview(null)}
              />
            ))}
            {group.groups.map((child) => renderGroup(child, `${path}/${child.id}`, level + 1))}
          </>
        )}
      />
    )
  }

  return (
    <div className="hwlisting">
      <div className="hwtopbar">
        <input
          type="text"
          placeholder={t("Search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="hwfilter">
        <FilterIcon icon="fitting-lowslot" title={t("Filter: Low Slot")} selected={filter.low} onClick={() => onToggleFilter("low")} />
        <FilterIcon icon="fitting-medslot" title={t("Filter: Mid Slot")} selected={filter.med} onClick={() => onToggleFilter("med")} />
        <FilterIcon icon="fitting-hislot" title={t("Filter: High Slot")} selected={filter.high} onClick={() => onToggleFilter("high")} />
        <FilterIcon icon="fitting-rig-subsystem" title={t("Filter: Rig & Subsystem Slots")} selected={filter.rig} onClick={() => onToggleFilter("rig")} />
        <FilterIcon icon="fitting-drones" title={t("Filter: Drones")} selected={filter.drone} onClick={() => onToggleFilter("drone")} />
      </div>

      <div className="hwSelectionHeader">
        <div onClick={() => setSelection("modules")} className={selection === "modules" ? "selected" : ""}>
          {t("Modules")}
        </div>
        <div onClick={() => setSelection("charges")} className={selection === "charges" ? "selected" : ""}>
          {t("Charges")}
        </div>
      </div>

      <div className="hwlistingContent">
        {tree === null && !treeError && <div className="empty dim">{t("working…")}</div>}
        {treeError && <div className="banner-error">{treeError}</div>}
        {tree !== null && !treeError && view.length === 0 && <div className="empty dim">{t("No Item")}</div>}
        {tree !== null && !treeError && view.map((group) => renderGroup(group, String(group.id), 1))}
      </div>
    </div>
  )
}

const FilterIcon = ({
  icon,
  title,
  selected,
  onClick,
}: {
  icon: IconName
  title: string
  selected: boolean
  onClick: () => void
}) => (
  <span className={selected ? "selected" : ""} onClick={onClick}>
    <Icon name={icon} size={32} title={title} />
  </span>
)
