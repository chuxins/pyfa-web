import React from "react"

/**
 * The eveship.fit UI icon set: small in-game window icons (fitting stats, slot
 * filters, window icons), served from /images/ui/. The names and the artwork are
 * the same eveship.fit uses (see @eveshipfit/react Icon.tsx).
 */
const ICON_NAMES = [
  "align-time",
  "armor-hp",
  "armor-repair-rate",
  "arrow-left",
  "arrow-right",
  "cargo-hold",
  "damage-alpha",
  "damage-dps",
  "drone-bay",
  "em-resistance",
  "explosive-resistance",
  "fitting-alliance",
  "fitting-character",
  "fitting-corporation",
  "fitting-drones",
  "fitting-hislot",
  "fitting-hull",
  "fitting-hull-restriction",
  "fitting-local",
  "fitting-lowslot",
  "fitting-medslot",
  "fitting-rig-subsystem",
  "hardpoint-launcher",
  "hardpoint-turret",
  "hull-hp",
  "hull-repair-rate",
  "inertia-modifier",
  "kinetic-resistance",
  "mass",
  "maximum-locked-targets",
  "menu-collapse",
  "menu-expand",
  "passive-shield-recharge",
  "scan-resolution",
  "sensor-strength",
  "shield-boost-rate",
  "shield-hp",
  "signature-radius",
  "simulate",
  "thermal-resistance",
  "warp-speed",
] as const

export type IconName = (typeof ICON_NAMES)[number]

export const Icon = ({
  name,
  size,
  title,
  className,
  onClick,
}: {
  name: IconName
  size?: number
  title?: string
  className?: string
  onClick?: (e: React.MouseEvent) => void
}) => {
  if (!ICON_NAMES.includes(name)) return <span>Unknown icon: {name}</span>
  return (
    <img
      src={`${import.meta.env.BASE_URL}images/ui/${name}.png`}
      width={size}
      height={size}
      title={title}
      className={className}
      onClick={onClick}
      alt=""
    />
  )
}
