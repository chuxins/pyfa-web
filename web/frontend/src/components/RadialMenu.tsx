import React from "react"

const highlightSettings = {
  Low: { width: 12, height: 3, x: 0, y: 9 },
  Medium: { width: 3, height: 12, x: 9, y: 0 },
  High: { width: 12, height: 3, x: 0, y: 0 },
} as const

/** The little radial menu marker (high / medium / low) at the start of each rack. */
export const RadialMenu = (props: { type: "Low" | "Medium" | "High" }) => {
  const highlight = highlightSettings[props.type]

  return (
    <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" className="sfRadialMenu">
      <defs>
        <mask id={`radial-menu-${props.type}`}>
          <rect style={{ fill: "#ffffff", fillOpacity: 0.5 }} width={12} height={12} x={0} y={0} />
          <rect style={{ fill: "#ffffff" }} width={highlight.width} height={highlight.height} x={highlight.x} y={highlight.y} />
          <circle style={{ fill: "#000000" }} cx={6} cy={6} r={5} />
          <rect style={{ fill: "#000000" }} width={3} height={3} x={0} y={0} />
          <rect style={{ fill: "#000000" }} width={4} height={3} x={9} y={0} />
          <rect style={{ fill: "#000000" }} width={3} height={4} x={0} y={9} />
          <rect style={{ fill: "#000000" }} width={4} height={4} x={9} y={9} />
        </mask>
      </defs>
      <g>
        <rect style={{ fill: "#ffffff" }} width={12} height={12} x={0} y={0} mask={`url(#radial-menu-${props.type})`} />
      </g>
    </svg>
  )
}
