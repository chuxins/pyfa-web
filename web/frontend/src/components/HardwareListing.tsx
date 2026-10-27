import React from "react"
import { Icon, type IconName } from "./Icon"
import { TreeListing, TreeHeader, TreeLeaf } from "./TreeListing"
import { TypeIcon } from "../images"
import { api, imageUrl, type MarketGroup, type MarketTreeItem } from "../api"
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

/** Racks in the order the fitting view draws them, so the weapon row matches it. */
const RACK_ORDER = ["high", "med", "low", "rig", "subsystem", "service"] as const

/**
 * One fitted row that can load a charge, drawn as a filter icon in the Charges
 * tab. Keyed by type rather than by position: six identical turrets load the same
 * ammunition, and six identical icons would say nothing the first one does not.
 */
interface ChargeWeapon {
  position: number
  itemId: number
  name: string
  loadedCharge: string | null
}

/**
 * The Hardware tab, eveship.fit's layout. One fetch of the whole market tree
 * (`GET /api/items/market-tree`) hands over every fit item grouped by market
 * group, so the tab draws all equipment up front instead of waiting for a query;
 * the filter icons, the search box and the Equipment/Charges sub-tabs filter that
 * one tree locally, and the groups remember their collapsed state.
 *
 * The filter row is contextual: the Equipment tab filters by slot, while the
 * Charges tab has no slots to filter by and shows the fit's own charge-holding
 * weapons instead -- clicking one narrows the ammunition list to what it loads.
 */
export const HardwareListing = () => {
  const addItem = useFittingStore((state) => state.addItem)
  const fit = useFittingStore((state) => state.fit)
  const setPreview = useUiStore((state) => state.setPreview)

  const [tree, setTree] = React.useState<MarketGroup[] | null>(null)
  const [treeError, setTreeError] = React.useState("")
  const [selection, setSelection] = React.useState<"modules" | "charges">("modules")
  const [filter, setFilter] = React.useState<HardwareFilter>({ low: false, med: false, high: false, rig: false, drone: false })
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  /** The weapon the Charges tab is narrowed to (type id, null = the whole list). */
  const [weaponFilter, setWeaponFilter] = React.useState<number | null>(null)
  /** Charges each fitted weapon accepts, keyed "<fitId>:<position>" (GET .../charges). */
  const [acceptedCharges, setAcceptedCharges] = React.useState<Record<string, number[]>>({})
  const [chargesLoading, setChargesLoading] = React.useState(false)

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

  /** The fit's charge-holding weapons, in rack order, one entry per type. */
  const weapons = React.useMemo<ChargeWeapon[]>(() => {
    if (!fit) return []
    const seen = new Set<number>()
    const rows: ChargeWeapon[] = []
    for (const rack of RACK_ORDER) {
      for (const module of fit.racks?.[rack] ?? []) {
        const itemId = module.itemId
        if (module.isEmpty || itemId === null || itemId === undefined || !module.canFitCharges) continue
        if (seen.has(itemId)) continue
        seen.add(itemId)
        rows.push({
          position: module.position,
          itemId,
          name: module.item?.name ?? String(itemId),
          loadedCharge: module.charge?.item?.name ?? null,
        })
      }
    }
    return rows
  }, [fit])

  /**
   * The weapon the user picked, if the fit still carries it: one at a time, so the
   * list answers "what can this gun fire" and never a union of several.
   */
  const selectedWeapon = React.useMemo(
    () => (weaponFilter === null ? null : weapons.find((weapon) => weapon.itemId === weaponFilter) ?? null),
    [weapons, weaponFilter],
  )

  // Ask the server what the picked weapon can load. Answered per module row (a
  // mutated module can differ from its type), so it is cached per position.
  React.useEffect(() => {
    if (selection !== "charges" || !fit || selectedWeapon === null) return
    const keyOf = (weapon: ChargeWeapon) => `${fit.id}:${weapon.position}`
    if (acceptedCharges[keyOf(selectedWeapon)] !== undefined) return
    const weapon = selectedWeapon

    let alive = true
    setChargesLoading(true)
    void api
      .charges(weapon.itemId, fit.id, weapon.position)
      .then(({ charges }) => [keyOf(weapon), charges.map((row) => row.item.id)] as [string, number[]])
      .catch(() => {
        // A row that has gone away since the click (or an engine refusal) simply
        // accepts nothing; the list then says so instead of failing the tab.
        return [keyOf(weapon), []] as [string, number[]]
      })
      .then(([key, ids]) => {
        if (!alive) return
        setAcceptedCharges((current) => ({ ...current, [key]: ids }))
      })
      .finally(() => {
        if (alive) setChargesLoading(false)
      })

    return () => {
      alive = false
    }
  }, [selection, fit, selectedWeapon, acceptedCharges])

  /**
   * The ammunition the picked weapon accepts, or null when the list is not
   * narrowed at all. While the first answer is in flight the list stays wide
   * rather than flashing empty.
   */
  const chargeFilter = React.useMemo<Set<number> | null>(() => {
    if (selection !== "charges" || !fit || selectedWeapon === null) return null
    const ids = new Set(acceptedCharges[`${fit.id}:${selectedWeapon.position}`] ?? [])
    if (ids.size === 0 && chargesLoading) return null
    return ids
  }, [selection, fit, selectedWeapon, acceptedCharges, chargesLoading])

  /** One weapon at a time: clicking the armed one again lifts the filter. */
  const toggleWeapon = (itemId: number) => {
    setWeaponFilter((current) => (current === itemId ? null : itemId))
  }

  /** The filtered tree: only groups that still hold a matching item remain. */
  const view = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const anyFilter = filter.low || filter.med || filter.high || filter.rig || filter.drone

    const matches = (item: MarketTreeItem): boolean => {
      if (selection === "charges") {
        if (item.kind !== "charge") return false
        if (chargeFilter !== null && !chargeFilter.has(item.id)) return false
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
  }, [tree, selection, filter, query, chargeFilter])

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
    // 拖动跟随图用本机静态图标（/img/icons，一年缓存）；没有图标的条目交给浏览器默认
    const image = imageUrl(item.image, 1)
    if (image) {
      try {
        const img = new Image()
        img.src = image
        e.dataTransfer.setDragImage(img, 32, 32)
      } catch {
        // ignore
      }
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
        {selection === "modules" && (
          <>
            <FilterIcon icon="fitting-lowslot" title={t("Filter: Low Slot")} selected={filter.low} onClick={() => onToggleFilter("low")} />
            <FilterIcon icon="fitting-medslot" title={t("Filter: Mid Slot")} selected={filter.med} onClick={() => onToggleFilter("med")} />
            <FilterIcon icon="fitting-hislot" title={t("Filter: High Slot")} selected={filter.high} onClick={() => onToggleFilter("high")} />
            <FilterIcon icon="fitting-rig-subsystem" title={t("Filter: Rig & Subsystem Slots")} selected={filter.rig} onClick={() => onToggleFilter("rig")} />
            <FilterIcon icon="fitting-drones" title={t("Filter: Drones")} selected={filter.drone} onClick={() => onToggleFilter("drone")} />
          </>
        )}

        {selection === "charges" && weapons.length === 0 && (
          <div className="hwWeaponsEmpty dim">{t("No fitted equipment can load charges")}</div>
        )}
        {selection === "charges" && weapons.length > 0 && (
          <div className="hwWeapons" title={t("Filter: Fitted Weapons")}>
            {weapons.map((weapon) => {
              const selected = weaponFilter === weapon.itemId
              const title = [
                weapon.loadedCharge
                  ? t("{weapon} · loaded: {charge}", { weapon: weapon.name, charge: weapon.loadedCharge })
                  : weapon.name,
                t("Click to show only the charges it can load"),
              ].join("\n")
              return (
                <span
                  key={weapon.itemId}
                  className={(selected ? "selected" : "") + (weapon.loadedCharge ? " loaded" : "")}
                  title={title}
                  onClick={() => toggleWeapon(weapon.itemId)}
                >
                  <TypeIcon typeId={weapon.itemId} size={32} />
                </span>
              )
            })}
          </div>
        )}
      </div>

      <div className="hwSelectionHeader">
        <div onClick={() => setSelection("modules")} className={selection === "modules" ? "selected" : ""}>
          {t("Equipment")}
        </div>
        <div onClick={() => setSelection("charges")} className={selection === "charges" ? "selected" : ""}>
          {t("Charges")}
        </div>
      </div>

      <div className="hwlistingContent">
        {tree === null && !treeError && <div className="empty dim">{t("working…")}</div>}
        {treeError && <div className="banner-error">{treeError}</div>}
        {tree !== null && !treeError && view.length === 0 && (
          <div className="empty dim">
            {selection === "charges" && selectedWeapon !== null && !chargesLoading
              ? t("This weapon loads nothing from this list")
              : t("No Item")}
          </div>
        )}
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
