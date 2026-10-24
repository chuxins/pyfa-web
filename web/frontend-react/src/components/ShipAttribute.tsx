import React from "react"

/** Format a number the way eveship.fit's ShipAttribute does (fixed decimals,
 *  optional divide-by and unit). The increase/decrease coloring is skipped: the
 *  server-authoritative stats have no baseline snapshot to compare against. */
export const Attr = ({
  value,
  fixed = 0,
  divideBy,
  unit,
  roundDown,
  roundUp,
}: {
  value: number | null | undefined
  fixed?: number
  divideBy?: number
  unit?: string
  roundDown?: boolean
  roundUp?: boolean
}) => {
  let v = value ?? 0
  if (divideBy) v /= divideBy
  const k = Math.pow(10, fixed)
  if (roundUp) v = Math.ceil(v * k) / k
  else if (roundDown) v = Math.floor(v * k) / k
  else v = Math.round(v * k) / k
  if (Object.is(v, -0)) v = 0
  const text = v.toLocaleString("en", { minimumFractionDigits: fixed, maximumFractionDigits: fixed })
  const prefix = unit === undefined ? "" : unit === "s" || unit === "x" || unit === "%" ? unit : ` ${unit}`
  return (
    <span>
      {text}
      {prefix}
    </span>
  )
}
