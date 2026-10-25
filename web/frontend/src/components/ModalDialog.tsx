import React, { useLayoutEffect } from "react"
import { createPortal } from "react-dom"

/**
 * The eveship.fit modal dialog: rendered through a portal into a <ModalDialogAnchor/>
 * (inside the main content panel, which is position:relative). Clicking the dim
 * backdrop or pressing Escape closes it.
 */
export const ModalDialog = ({
  title,
  onClose,
  children,
  className,
  width = 520,
  visible = true,
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  className?: string
  width?: number
  visible?: boolean
}) => {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (anchor !== null) return
    const el = document.getElementById("modalDialogAnchor")
    if (el === null) return
    setAnchor(el)
  }, [anchor])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  if (!visible || anchor === null) return null

  return createPortal(
    <div className="modalDialog" onClick={() => onClose()}>
      <div className={"modalContent" + (className ? ` ${className}` : "")} style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">{title}</div>
        {children}
      </div>
    </div>,
    anchor,
  )
}

/** Anchor for modal dialogs; put this inside the main content panel. */
export const ModalDialogAnchor = () => {
  return <div id="modalDialogAnchor"></div>
}

