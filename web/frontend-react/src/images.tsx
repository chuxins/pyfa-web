/**
 * EVEShipFit/images: EVE Online's icons as layered WebP (icon + tech/faction
 * marker), the same icon system eveship.fit uses. The images/ folder and
 * images.dat are copied into the build by vite-plugin-static-copy (see
 * vite.config.ts); in dev the built package folder is served through the same
 * copy, so icons work identically in both modes.
 */
import React from "react"
import { loadImages, type Images, type Layer } from "@eveshipfit/images"
import imagesUrl from "@eveshipfit/images/dist/images.dat?url"

let imagesPromise: Promise<Images> | null = null

/** Load (once) and keep the shared Images instance. */
export function images(): Promise<Images> {
  if (!imagesPromise) {
    imagesPromise = loadImages({ url: imagesUrl }, { baseUrl: `${import.meta.env.BASE_URL}images/` })
  }
  return imagesPromise
}

/**
 * A type's icon, drawn like eveship.fit draws it: every layer at its own size
 * from the top-left of a 64px canvas, markers included, scaled via CSS zoom.
 */
export function TypeIcon({
  typeId,
  size = 64,
  marker = true,
  copy = false,
  className,
  title,
}: {
  typeId: number
  size?: number
  marker?: boolean
  copy?: boolean
  className?: string
  title?: string
}) {
  const [layers, setLayers] = React.useState<Layer[] | undefined>(undefined)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    setFailed(false)
    void images()
      .then((imgs) => {
        if (alive) setLayers(imgs.typeIcon(typeId, { marker, copy }))
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [typeId, marker, copy])

  if (failed || !layers) return <span className={className} style={{ width: 64, height: 64, display: "inline-block" }} />

  return (
    <span
      className={className}
      title={title}
      style={{
        position: "relative",
        display: "inline-block",
        width: 64,
        height: 64,
        zoom: size / 64,
        isolation: "isolate",
        lineHeight: 0,
      }}
    >
      {layers.map((layer) => (
        <img
          key={layer.src}
          src={layer.src}
          alt=""
          loading="lazy"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            mixBlendMode: layer.additive ? "plus-lighter" : undefined,
          }}
        />
      ))}
    </span>
  )
}
