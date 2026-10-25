import React from "react"
import { Icon, type IconName } from "./Icon"

/**
 * The eveship.fit tree listing: collapsible rows (groups, races, hulls) with
 * leaves (fits, items) underneath. Every header uses a --height CSS variable so
 * the row size stays in sync with its icon size.
 */
interface Tree {
  size: number
}

export const TreeContext = React.createContext<Tree>({ size: 24 })

export const TreeHeaderAction = (props: {
  icon: IconName
  onClick: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
}) => {
  const tree = React.useContext(TreeContext)
  return (
    <div className="treeHeaderAction" onClick={props.onClick}>
      <Icon name={props.icon} size={tree.size} />
    </div>
  )
}

export const TreeHeader = (props: { icon?: string; text: string; action?: React.ReactNode }) => {
  const tree = React.useContext(TreeContext)
  return (
    <>
      {props.icon !== undefined && (
        <span>
          <img src={props.icon} height={tree.size} width={tree.size} alt="" />
        </span>
      )}
      <span className="treeHeaderText">{props.text}</span>
      {props.action && <span>{props.action}</span>}
    </>
  )
}

export const TreeLeaf = (props: {
  level: number
  height?: number
  icon?: IconName
  iconTitle?: string
  content: string
  /** A right-aligned action (e.g. the fit delete X); shown on row hover. */
  action?: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  title?: string
}) => {
  const stylesHeader = `treeHeader treeHeader${props.level}`
  const height = props.height ?? 24
  const style = { "--height": `${height}px` } as React.CSSProperties
  const interactive = props.onClick !== undefined || props.onDoubleClick !== undefined

  return (
    <div>
      <TreeContext.Provider value={{ size: height }}>
        <div
          style={style}
          className={`${stylesHeader}${interactive ? " treeHeaderHover treeLeaf" : ""}`}
          onClick={props.onClick}
          onDoubleClick={props.onDoubleClick}
          draggable={!!props.onDragStart}
          onDragStart={props.onDragStart}
          onMouseEnter={props.onMouseEnter}
          onMouseLeave={props.onMouseLeave}
          title={props.title}
        >
          {props.icon !== undefined && (
            <span className="treeLeafIcon">
              <Icon name={props.icon} size={12} title={props.iconTitle} />
            </span>
          )}
          <span className="treeHeaderText">{props.content}</span>
          {props.action !== undefined && (
            <span className="treeLeafAction" onClick={(e) => e.stopPropagation()}>
              {props.action}
            </span>
          )}
        </div>
      </TreeContext.Provider>
    </div>
  )
}

export const TreeListing = (props: {
  level: number
  header?: React.ReactNode
  height?: number
  getChildren: () => React.ReactNode
  /** Controlled open state. When given, the caller owns the toggle (search force-expand). */
  expanded?: boolean
  onToggle?: (open: boolean) => void
  /** Drag the whole header row (used for hull rows: a ship dragged onto the ring creates a fit). */
  onHeaderDragStart?: (e: React.DragEvent<HTMLDivElement>) => void
}) => {
  const [internal, setInternal] = React.useState(props.header === undefined)

  const stylesHeader = `treeHeader treeHeader${props.level} treeHeaderHover`
  const stylesContent = `treeContent${props.level}`
  const height = props.height ?? 26
  const style = { "--height": `${height}px` } as React.CSSProperties

  const expanded = props.expanded ?? internal

  let children: React.ReactNode = <></>
  if (expanded) {
    children = props.getChildren()
  }

  return (
    <div>
      <TreeContext.Provider value={{ size: height }}>
        {props.header !== undefined && (
          <div
            style={style}
            className={stylesHeader}
            draggable={!!props.onHeaderDragStart}
            onDragStart={props.onHeaderDragStart}
            onClick={() => {
              const next = !expanded
              if (props.onToggle !== undefined) props.onToggle(next)
              else setInternal(next)
            }}
          >
            <span>
              <Icon name={expanded ? "menu-expand" : "menu-collapse"} size={12} />
            </span>
            {props.header}
          </div>
        )}
        <div className={`${stylesContent}${props.header !== undefined ? " treeContent" : ""}`}>{children}</div>
      </TreeContext.Provider>
    </div>
  )
}
