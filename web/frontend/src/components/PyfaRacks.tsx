import React from "react"
import { api, imageUrl, type ChargeRow, type Module } from "../api"
import { handleModuleDrop, handleRingDrop, isItemDrag } from "../dragdrop"
import { TypeIcon } from "../images"
import { RACK_ORDER, rackLabel, stateLabel } from "../labels"
import { useFittingStore } from "../store/fitting"
import { useUiStore } from "../store/ui"
import { t } from "../i18n"
import { ModalDialog } from "./ModalDialog"
import { ShipModes } from "./ShipModes"
import { CargoBay } from "./CargoBay"
import { DroneBay } from "./DroneBay"
import { FighterBay } from "./FighterBay"

/**
 * pyfa 风格的装配面板：高/中/低/改装件/子系统按排架竖着列出来，每行一个槽位
 * （图标、名称、弹药、状态、卸下），下面接着无人机、舰载机、植入体、增效剂和货舱。
 *
 * 竖屏（手机）用它代替 eveship.fit 的径向环：环是正方形，窄而高的列放不下；
 * pyfa 桌面版的这一套行列表在窄列里反而好按。触摸屏没有鼠标悬停，所以每个动作
 * 都有自己的按钮：点空槽开物品选择器、点弹药开弹药列表、点状态循环状态、× 卸下。
 *
 * 装配栏里的其它面板能复用就直接复用桌面的那几块：战术模式（ShipModes）、
 * 无人机舱 / 舰载机库 / 货舱（DroneBay / FighterBay / CargoBay）——同一份组件、
 * 同一批命令，只是竖屏把浮层摊成栏内的行列表（见 app.css 的 .pPyfa 规则）。
 */

/** 后端物品搜索认识这些 scope，空槽才开得出选择器（模式/系统槽没有模块列表）。 */
const PICKER_SLOTS = ["high", "med", "low", "rig", "subsystem", "service"]

export const PyfaRacks = () => {
  const fit = useFittingStore((state) => state.fit)
  const weaponGroups = useFittingStore((state) => state.weaponGroups)
  const toggleWeaponGroups = useFittingStore((state) => state.toggleWeaponGroups)
  const [dragOver, setDragOver] = React.useState(false)

  if (!fit) {
    return (
      <div className="fitting pPyfa">
        <div
          className={"pDropEmpty" + (dragOver ? " over" : "")}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            handleRingDrop(event)
            setDragOver(false)
          }}
        >
          {t("Drop a ship here to create a fit, or drag a fit here to open it")}
        </div>
      </div>
    )
  }

  const slots = fit.ship.slots ?? {}
  const stats = fit.stats
  const highModules = (fit.racks.high ?? []).filter((module) => !module.isEmpty && module.hardpoint)
  const highTypes = new Set(highModules.map((module) => module.itemId)).size
  const grouped = highModules.length > 1 && highTypes < highModules.length

  const drones = (fit.drones ?? []).filter((drone) => drone.itemId !== null)
  const fighters = (fit.fighters ?? []).filter((fighter) => fighter.itemId !== null)
  const cargo = (fit.cargo ?? []).filter((entry) => entry.item !== null)
  const implants = (fit.implants ?? []).filter((implant) => implant.itemId !== null)
  const boosters = (fit.boosters ?? []).filter((booster) => booster.itemId !== null)

  return (
    <div
      className="fitting pPyfa"
      // A ship or a fit dragged onto the panel behaves like a drop on the ring
      onDragEnter={(event) => {
        if (!isItemDrag(event)) return
        event.preventDefault()
        setDragOver(true)
      }}
      onDragOver={(event) => {
        if (isItemDrag(event)) event.preventDefault()
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        setDragOver(false)
        handleRingDrop(event)
      }}
      data-dropover={dragOver}
    >
      <div className="shipheader">
        <img
          className="pfHull"
          src={imageUrl(fit.ship.item.image, 2) ?? undefined}
          alt=""
          loading="lazy"
        />
        <div className="shipheadermeta">
          <span className="shipname">{fit.ship.item.name}</span>
          <span className="mono dim">
            CPU {(stats?.resources.cpu.used ?? 0).toFixed(1)}/{(stats?.resources.cpu.total ?? 0).toFixed(1)} · PG{" "}
            {(stats?.resources.powergrid.used ?? 0).toFixed(1)}/{(stats?.resources.powergrid.total ?? 0).toFixed(1)}
          </span>
        </div>
      </div>

      {/* 战术模式切换（T3D / 蛇鹈号）：与径向环上那颗同一个组件、同一条命令 */}
      <ShipModes />

      {RACK_ORDER.map((rack) => {
        const modules = (fit.racks[rack] ?? []).slice().sort((a, b) => a.position - b.position)
        const total = slots[rack] ?? modules.length
        if (modules.length === 0 && total === 0) return null
        const used = modules.filter((module) => !module.isEmpty).length
        // 少于舱位数时补几行空槽：手机上点空槽就是装配入口
        const fillers = Math.max(0, total - modules.length)

        return (
          <section key={rack} className={`rack slot-${rack}`}>
            <div className="rackhead">
              <span className="rackname">{rackLabel(rack)}</span>
              <span className="racktail">
                {rack === "high" && grouped && (
                  <button
                    className={"groupbtn" + (weaponGroups ? " active" : "")}
                    onClick={() => toggleWeaponGroups()}
                    title={t(
                      weaponGroups
                        ? "Ungroup: every weapon goes back to being on its own"
                        : "Group the same weapons in this rack so one click or charge reaches them all",
                    )}
                  >
                    {t(weaponGroups ? "ungroup weapons" : "group weapons")}
                  </button>
                )}
                <span className="dim mono">
                  {used} / {total}
                </span>
              </span>
            </div>
            {modules.map((module) => (
              <ModuleRow key={module.position} module={module} rack={rack} />
            ))}
            {Array.from({ length: fillers }, (_, index) => (
              <ModuleRow key={`${rack}-empty-${index}`} rack={rack} module={null} />
            ))}
          </section>
        )
      })}

      {/* 货舱/无人机/舰载机直接复用桌面的那三块面板（ShipFitExtended 里的浮层
          就是它们），竖屏只是把浮层改成栏内的一行行列表（见 app.css 的 .pPyfa） */}
      {drones.length > 0 && (
        <section className="containerblock">
          <div className="rackhead">
            <span className="rackname">{t("Drones")}</span>
          </div>
          <DroneBay />
        </section>
      )}

      {fighters.length > 0 && (
        <section className="containerblock">
          <div className="rackhead">
            <span className="rackname">{t("Fighters")}</span>
          </div>
          <FighterBay />
        </section>
      )}

      {implants.length > 0 && (
        <section className="containerblock">
          <div className="rackhead">
            <span className="rackname">{t("Implants")}</span>
            <span className="racktail dim">
              {t(fit.implantLocation === 1 ? "from character" : "from fit")}
              <button
                className="load"
                title={t("implants come from the character's clone or from the fit")}
                onClick={() =>
                  void useFittingStore
                    .getState()
                    .send("changeImplantLocation", { source: fit.implantLocation === 1 ? 0 : 1 })
                }
              >
                {t("switch")}
              </button>
            </span>
          </div>
          {implants.map((implant) => (
            <StateRow
              key={`implant-${implant.position}`}
              itemId={implant.itemId}
              name={implant.item?.name ?? ""}
              active={implant.state !== "offline"}
              onToggle={() => void useFittingStore.getState().toggleImplant(implant.position)}
              onRemove={() => void useFittingStore.getState().removeImplant(implant.position)}
            />
          ))}
        </section>
      )}

      {boosters.length > 0 && (
        <section className="containerblock">
          <div className="rackhead">
            <span className="rackname">{t("Boosters")}</span>
          </div>
          {boosters.map((booster) => (
            <StateRow
              key={`booster-${booster.position}`}
              itemId={booster.itemId}
              name={booster.item?.name ?? ""}
              active={booster.active}
              onToggle={() => void useFittingStore.getState().toggleBooster(booster.position)}
              onRemove={() => void useFittingStore.getState().removeBooster(booster.position)}
            />
          ))}
        </section>
      )}

      {cargo.length > 0 && (
        <section className="containerblock">
          <div className="rackhead">
            <span className="rackname">{t("Cargo")}</span>
            <span className="dim mono">
              {(stats?.resources.cargo.used ?? 0).toFixed(1)} / {(stats?.resources.cargo.total ?? 0).toFixed(1)} m³
            </span>
          </div>
          <CargoBay />
        </section>
      )}
    </div>
  )
}

/* --------------------------------------------------------------------------
   一行槽位
   -------------------------------------------------------------------------- */

const ModuleRow = (props: { module: Module | null; rack: string }) => {
  const module = props.module
  const cycleModuleState = useFittingStore((state) => state.cycleModuleState)
  const removeModule = useFittingStore((state) => state.removeModule)
  const openSlotPicker = useUiStore((state) => state.openSlotPicker)
  const [dropTarget, setDropTarget] = React.useState(false)
  const [chargeOpen, setChargeOpen] = React.useState(false)

  const pickable = PICKER_SLOTS.includes(props.rack)
  const hasItem = module !== null && !module.isEmpty && module.item !== null
  const position = module?.position ?? -1

  const openPicker = () => {
    if (!pickable) return
    openSlotPicker(props.rack, position)
  }

  return (
    <div
      className={
        "module" +
        (hasItem ? "" : " empty") +
        (dropTarget ? " pDrop" : "") +
        (pickable && !hasItem ? " slot-tap" : "")
      }
      onDragOver={(event) => {
        if (!isItemDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        setDropTarget(false)
        handleModuleDrop(event, hasItem ? position : -1)
      }}
    >
      <span className="pfIcon">
        {hasItem && module?.item ? (
          <TypeIcon typeId={module.charge?.item.id ?? module.item.id} size={26} />
        ) : (
          <span className="icon placeholder" />
        )}
      </span>

      <button
        className={"name" + (hasItem ? "" : " empty")}
        disabled={!hasItem && !pickable}
        onClick={() => (hasItem || pickable ? openPicker() : undefined)}
        title={hasItem ? t("replace the module in this slot") : pickable ? t("add a module…") : ""}
      >
        {hasItem ? module?.item?.name : pickable ? t("add a module…") : ""}
        {hasItem && module?.isMutated && <span className="tag">{t("mutated")}</span>}
      </button>

      <span className="charge">
        {hasItem && module?.charge ? (
          <>
            <button className="chargebtn" onClick={() => setChargeOpen(true)} title={t("click to change the charge")}>
              {module.charge.item.name}
            </button>
            <span className="dim mono">x{module.charge.amount}</span>
          </>
        ) : hasItem && module?.canFitCharges ? (
          <button className="load" onClick={() => setChargeOpen(true)}>
            {t("load…")}
          </button>
        ) : null}
      </span>

      {hasItem && module && (
        <button
          className={"state " + module.state}
          title={stateLabel(module.state)}
          onClick={(event) =>
            void cycleModuleState(
              { position: module.position, itemId: module.itemId },
              event.shiftKey ? "left" : "cycle",
            )
          }
          onContextMenu={(event) => {
            event.preventDefault()
            void cycleModuleState({ position: module.position, itemId: module.itemId }, "right")
          }}
        >
          {stateLabel(module.state)}
        </button>
      )}

      {hasItem && module && (
        <button
          className="remove danger"
          title={t("Remove")}
          onClick={() => void removeModule({ position: module.position })}
        >
          &times;
        </button>
      )}

      {chargeOpen && hasItem && module?.item && (
        <ChargeDialog position={position} itemId={module.item.id} onClose={() => setChargeOpen(false)} />
      )}
    </div>
  )
}

/* --------------------------------------------------------------------------
   弹药列表：触摸屏上换弹的最短路径（没有拖拽）
   -------------------------------------------------------------------------- */

const ChargeDialog = (props: { position: number; itemId: number; onClose: () => void }) => {
  const fitId = useFittingStore((state) => state.fit?.id ?? null)
  const loadChargeAt = useFittingStore((state) => state.loadChargeAt)
  const [rows, setRows] = React.useState<ChargeRow[] | null>(null)

  React.useEffect(() => {
    let alive = true
    void api
      .charges(props.itemId, fitId ?? undefined, props.position)
      .then((payload) => {
        if (alive) setRows(payload.charges)
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [props.itemId, props.position, fitId])

  const load = (chargeItemId: number | null) => {
    void loadChargeAt(props.position, chargeItemId)
    props.onClose()
  }

  return (
    <ModalDialog title={t("Charge")} onClose={props.onClose} width={420}>
      <div className="scroll pickerList">
        <button className="pickerrow" onClick={() => load(null)}>
          <span className="itemrowname dim">{t("Remove Charge")}</span>
        </button>
        {rows === null && <div className="dim">{t("working…")}</div>}
        {rows?.map((row) => (
          <button key={row.item.id} className="pickerrow" onClick={() => load(row.item.id)}>
            <TypeIcon typeId={row.item.id} size={26} />
            <span className="itemrowname">{row.item.name}</span>
            {row.amount ? <span className="tag">x{row.amount}</span> : null}
          </button>
        ))}
        {rows?.length === 0 && <div className="dim pEmptyNote">{t("no charges")}</div>}
      </div>
    </ModalDialog>
  )
}

/** 植入体和增效剂只有「启用/停用」和「卸下」两个动作，共用一个行组件。 */
const StateRow = (props: {
  itemId: number | null
  name: string
  active: boolean
  onToggle: () => void
  onRemove: () => void
}) => {
  return (
    <div className="module">
      <span className="pfIcon">
        {props.itemId !== null ? <TypeIcon typeId={props.itemId} size={26} /> : <span className="icon placeholder" />}
      </span>
      <span className="name">{props.name}</span>
      <button className={"state " + (props.active ? "active" : "offline")} onClick={props.onToggle}>
        {t(props.active ? "active" : "offline")}
      </button>
      <button className="remove danger" title={t("Remove")} onClick={props.onRemove}>
        &times;
      </button>
    </div>
  )
}

// Booster 类型在这里只作为行数据的形状使用（StateRow 已经覆盖了它的字段）
