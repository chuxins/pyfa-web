import React from "react"

const getPositionOnCircle = (angle: number, radius: number, center: number) => {
  const x = radius * Math.cos((angle * Math.PI) / 180) + center
  const y = radius * Math.sin((angle * Math.PI) / 180) + center
  return { x, y }
}

/** The rig / CPU / powergrid usage arc drawn around the fit ring, exactly as
 *  eveship.fit draws it. `used` and `total` come from the server stats. */
export const Usage = (props: {
  used: number
  total: number
  angle: number
  intervals: number
  markers: number
  color: string
}) => {
  let usageUsed = Math.min(props.used, props.total)
  const radius = 232
  const degrees = props.angle
  // A zero total (stats not loaded yet, or a ship without rig slots) would make
  // the arc endpoint NaN and the browser log an SVG path error; draw nothing.
  const usageDegrees = props.total > 0 ? (degrees * usageUsed) / props.total : 0

  const pointsInterval = degrees / props.intervals
  const points = Array.from({ length: props.intervals }, (_, i) => {
    const angle = i * pointsInterval - 90
    return {
      inner: getPositionOnCircle(angle, radius - 15, 232 + 24),
      outer: getPositionOnCircle(angle, radius - 9, 232 + 24),
    }
  })
  const markersInterval = degrees / (props.markers - 1)
  const markers = Array.from({ length: props.markers }, (_, i) => {
    const angle = i * markersInterval - 90
    return {
      inner: getPositionOnCircle(angle, radius - 15, 232 + 24),
      outer: getPositionOnCircle(angle, radius - 2, 232 + 24),
    }
  })
  const usage = {
    start: getPositionOnCircle(-90, radius - 10, 232 + 24),
    end: getPositionOnCircle(-90 + usageDegrees, radius - 10, 232 + 24),
    radius: radius - 10,
  }

  return (
    <svg viewBox="24 24 464 464" xmlns="http://www.w3.org/2000/svg" className="sfRingOuter">
      <g>
        <path
          style={{ fill: "none", stroke: props.color, strokeWidth: 10 }}
          d={`M ${usage.start.x} ${usage.start.y} A ${usage.radius} ${usage.radius} 0 0 ${props.angle >= 0 ? "1" : "0"} ${usage.end.x} ${usage.end.y}`}
        />
        {markers.map((marker, i) => (
          <path
            key={i}
            style={{ fill: "none", stroke: "#7a7a7a", strokeWidth: 1 }}
            d={`M ${marker.inner.x} ${marker.inner.y} L ${marker.outer.x} ${marker.outer.y}`}
          />
        ))}
        {points.map((point, i) => (
          <path
            key={i}
            style={{ fill: "none", stroke: "#7a7a7a", strokeWidth: 1 }}
            d={`M ${point.inner.x} ${point.inner.y} L ${point.outer.x} ${point.outer.y}`}
          />
        ))}
      </g>
    </svg>
  )
}
