import React from "react"
import { Icon, type IconName } from "./Icon"
import { ModalDialog } from "./ModalDialog"
import { TreeListing, TreeHeader, TreeHeaderAction, TreeLeaf } from "./TreeListing"
import { useBrowserStore } from "../store/browser"
import { useFittingStore } from "../store/fitting"
import { imageUrl, type FitSummary, type ImageRef, type ShipCategory } from "../api"
import { MIME_FIT_ID, MIME_KIND, MIME_TYPE_ID } from "../dragdrop"
import { t } from "../i18n"

interface FitFilter {
  localFits: boolean
  characterFits: boolean
  currentHull: boolean
}

/**
 * The Hull & Fits tree, exactly as eveship.fit draws it: category, group, race,
 * hull, and the fits under each hull. Fits are fetched per session (character),
 * so a signed-in browser sees only its own character's fits.
 */
export const HullListing = () => {
  const categories = useBrowserStore((state) => state.categories)
  const allFits = useBrowserStore((state) => state.allFits)
  const loadAllFits = useBrowserStore((state) => state.loadAllFits)
  const openFit = useFittingStore((state) => state.open)
  const create = useFittingStore((state) => state.create)
  const removeFit = useFittingStore((state) => state.removeFit)
  const currentShipId = useFittingStore((state) => state.fit?.ship.id ?? null)

  const [search, setSearch] = React.useState("")
  const [filter, setFilter] = React.useState<FitFilter>({ localFits: false, characterFits: false, currentHull: false })
  /** The fit whose delete confirmation is open, if any. */
  const [pendingDelete, setPendingDelete] = React.useState<FitSummary | null>(null)

  const confirmDelete = async () => {
    const fit = pendingDelete
    if (!fit) return
    setPendingDelete(null)
    await removeFit(fit.id, fit, { confirmed: true })
  }

  React.useEffect(() => {
    void loadAllFits()
  }, [loadAllFits])

  const fitsByShip = React.useMemo(() => {
    const map: Record<number, FitSummary[] | undefined> = {}
    for (const fit of allFits) {
      const list = map[fit.shipId]
      if (list) list.push(fit)
      else map[fit.shipId] = [fit]
    }
    for (const shipId of Object.keys(map)) {
      const list = map[Number(shipId)]
      if (list) list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    }
    return map
  }, [allFits])

  const anyFilter = filter.localFits || filter.characterFits || filter.currentHull
  const searching = search.trim() !== ""

  const matchingFits = (shipId: number): FitSummary[] => {
    const fits = fitsByShip[shipId] ?? []
    if (!anyFilter) return fits
    return fits.filter((fit) => {
      if (filter.currentHull && shipId !== currentShipId) return false
      if (filter.localFits && fit.fromGame) return false
      if (filter.characterFits && !fit.fromGame) return false
      return true
    })
  }

  const showHull = (shipId: number, name: string): boolean => {
    if (searching && !name.toLowerCase().includes(search.trim().toLowerCase())) return false
    if (filter.currentHull && shipId !== currentShipId) return false
    if (anyFilter && matchingFits(shipId).length === 0) return false
    return true
  }

  return (
    <div className="hlisting">
      <div className="htopbar">
        <input type="text" placeholder={t("Search")} value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
      </div>
      <div className="hfilter">
        <FilterIcon
          icon="fitting-local"
          title={t("Filter: Browser-stored fittings")}
          selected={filter.localFits}
          onClick={() => setFilter({ ...filter, localFits: !filter.localFits })}
        />
        <FilterIcon
          icon="fitting-character"
          title={t("Filter: in-game personal fittings")}
          selected={filter.characterFits}
          onClick={() => setFilter({ ...filter, characterFits: !filter.characterFits })}
        />
        <FilterIcon icon="fitting-corporation" title={t("CCP didn't implement this ESI endpoint (yet?)")} disabled />
        <FilterIcon icon="fitting-alliance" title={t("CCP didn't implement this ESI endpoint (yet?)")} disabled />
        <FilterIcon
          icon="fitting-hull"
          title={t("Filter: current hull")}
          selected={filter.currentHull}
          onClick={() => setFilter({ ...filter, currentHull: !filter.currentHull })}
        />
      </div>
      <div className="hlistingContent">
        {categories.map((category) => (
          <HullCategory
            key={category.key}
            category={category}
            fitsByShip={fitsByShip}
            showHull={showHull}
            searching={searching}
            onOpenFit={(fitId) => void openFit(fitId)}
            onNewFit={(shipId) => void create(shipId)}
            onDeleteFit={(fit) => setPendingDelete(fit)}
          />
        ))}
        {categories.length === 0 && <div className="empty dim">{t("working…")}</div>}
      </div>

      <ModalDialog
        visible={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        className="fconfirm"
        width={420}
        title={t("Delete fitting")}
      >
        <div className="fconfirmText">
          {pendingDelete && (pendingDelete.fromGame || pendingDelete.importedToGame)
            ? t("Delete '{name}' from the website and from EVE?", { name: pendingDelete.name })
            : t("Delete '{name}'?", { name: pendingDelete?.name ?? "" })}
        </div>
        <div className="fconfirmButtons">
          <span className="fbutton fbuttonSmall" onClick={() => setPendingDelete(null)}>
            {t("Cancel")}
          </span>
          <span className="fbutton fbuttonSmall fbuttonDanger" onClick={() => void confirmDelete()}>
            {t("Delete")}
          </span>
        </div>
      </ModalDialog>
    </div>
  )
}

const FilterIcon = ({
  icon,
  title,
  selected,
  disabled,
  onClick,
}: {
  icon: IconName
  title: string
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
}) => (
  <span className={(selected ? "selected " : "") + (disabled ? "disabled" : "")} onClick={disabled ? undefined : onClick}>
    <Icon name={icon} size={32} title={title} />
  </span>
)

interface HullTreeProps {
  fitsByShip: Record<number, FitSummary[] | undefined>
  showHull: (shipId: number, name: string) => boolean
  /** While typing in the search box every tree level is force-expanded to reveal matches. */
  searching: boolean
  onOpenFit: (fitId: number) => void
  onNewFit: (shipId: number) => void
  onDeleteFit: (fit: FitSummary) => void
}

interface HullShip {
  id: number
  name: string
  /** 接口随行给出的本机渲染图（/img/renders/{graphicId}@2x，64px） */
  image?: ImageRef | null
  race?: { id: number | null; name: string; order: number } | null
}

const HullCategory = (props: HullTreeProps & { category: ShipCategory }) => {
  // Hide categories that have no match while searching, so only result cards remain.
  if (props.searching && !props.category.groups.some((group) => group.ships.some((ship) => props.showHull(ship.id, ship.name)))) {
    return null
  }
  return (
    <TreeListing
      level={0}
      header={<TreeHeader text={props.category.name} />}
      expanded={props.searching ? true : undefined}
      getChildren={() => (
        <>
          {props.category.groups.map((group) => (
            <HullGroup key={group.id} {...props} groupName={group.name} ships={group.ships} />
          ))}
        </>
      )}
    />
  )
}

const HullGroup = (props: HullTreeProps & { groupName: string; ships: HullShip[] }) => {
  const races = new Map<string, { order: number; ships: HullShip[] }>()
  for (const ship of props.ships) {
    const raceName = ship.race?.name ?? "Non-Empire"
    const entry = races.get(raceName)
    if (entry) entry.ships.push(ship)
    else races.set(raceName, { order: ship.race?.order ?? 99, ships: [ship] })
  }
  const raceList = [...races.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
  if (!props.ships.some((ship) => props.showHull(ship.id, ship.name))) return null

  return (
    <TreeListing
      level={1}
      header={<TreeHeader text={props.groupName} />}
      expanded={props.searching ? true : undefined}
      getChildren={() => (
        <>
          {raceList.map(([raceName, entry]) => (
            <HullRace key={raceName} {...props} raceName={raceName} ships={entry.ships} />
          ))}
        </>
      )}
    />
  )
}

const HullRace = (props: HullTreeProps & { raceName: string; ships: HullShip[] }) => {
  if (!props.ships.some((ship) => props.showHull(ship.id, ship.name))) return null
  return (
    <TreeListing
      level={2}
      header={<TreeHeader text={props.raceName} />}
      expanded={props.searching ? true : undefined}
      getChildren={() => (
        <>
          {props.ships
            .filter((ship) => props.showHull(ship.id, ship.name))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((ship) => (
              <HullRow key={ship.id} {...props} ship={ship} />
            ))}
        </>
      )}
    />
  )
}

const HullRow = (props: HullTreeProps & { ship: HullShip }) => {
  const fits = props.fitsByShip[props.ship.id] ?? []

  /** Drag a hull onto the ring: the ring creates a fresh fit for this ship. */
  const onShipDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(MIME_TYPE_ID, props.ship.id.toString())
    e.dataTransfer.setData(MIME_KIND, "ship")
    e.dataTransfer.effectAllowed = "copy"
    // 拖动跟随图用本机渲染图（/img/renders/@2x，64px，一年缓存）
    const thumb = imageUrl(props.ship.image, 2)
    if (thumb) {
      try {
        const img = new Image()
        img.src = thumb
        e.dataTransfer.setDragImage(img, 32, 32)
      } catch {
        // ignore
      }
    }
  }

  return (
    <TreeListing
      level={3}
      onHeaderDragStart={onShipDragStart}
      expanded={props.searching ? true : undefined}
      header={
        <TreeHeader
          // 船的缩略图：接口随行给出 /img/renders/{graphicId}@2x（本机 64px，
          // 比外链的 32px 更清楚，也不发外部请求）
          icon={imageUrl(props.ship.image, 2) ?? undefined}
          text={props.ship.name}
          action={
            <TreeHeaderAction
              icon="simulate"
              onClick={(e) => {
                e.stopPropagation()
                void props.onNewFit(props.ship.id)
              }}
            />
          }
        />
      }
      height={32}
      getChildren={() => (
        <>
          {fits.length === 0 && <TreeLeaf level={4} content={t("No Item")} />}
          {fits.map((fit, index) => (
            <TreeLeaf
              key={`${fit.id}-${index}`}
              level={4}
              content={fit.name}
              onClick={() => props.onOpenFit(fit.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData(MIME_FIT_ID, fit.id.toString())
                e.dataTransfer.effectAllowed = "copy"
              }}
              icon={fit.fromGame ? "fitting-character" : "fitting-local"}
              iconTitle={fit.fromGame ? t("In-game personal fitting") : t("Browser-stored fitting")}
              action={
                <span
                  className="treeLeafDelete"
                  role="button"
                  title={
                    fit.fromGame || fit.importedToGame
                      ? t("Delete from the website and from EVE")
                      : t("Delete fitting")
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onDeleteFit(fit)
                  }}
                >
                  ×
                </span>
              }
            />
          ))}
        </>
      )}
    />
  )
}
