/**
 * UI chrome translations, following pyfa's own gettext catalogue conventions.
 * Keys are the English source strings; item/attribute names come from the
 * server's Chinese game data, only the chrome lives here.
 */

export type LocaleCode = "zh_CN" | "en_US"

export const LOCALES: { code: LocaleCode; label: string }[] = [
  { code: "zh_CN", label: "中文（简体）" },
  { code: "en_US", label: "English" },
]

const STORAGE_KEY = "pyfa.locale"

// The catalogue is declared after ZH_CN below (see the end of this file).

let current: LocaleCode = "zh_CN"

function isSupported(code: string | null | undefined): code is LocaleCode {
  return code === "zh_CN" || code === "en_US"
}

/** Switch the chrome language. */
export function setLocale(code: LocaleCode, persist = true) {
  current = code
  if (typeof document !== "undefined") {
    document.documentElement.lang = code === "zh_CN" ? "zh-CN" : "en"
  }
  if (!persist) return
  try {
    window.localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // nothing to do
  }
}

/** Decide the initial chrome language: stored choice, server language, browser, then English. */
export function initLocale(serverLanguage?: string | null) {
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  if (isSupported(stored)) {
    setLocale(stored, false)
    return
  }
  if (isSupported(serverLanguage)) {
    setLocale(serverLanguage, false)
    return
  }
  const browser = typeof navigator === "undefined" ? "" : navigator.language
  setLocale(browser.toLowerCase().startsWith("zh") ? "zh_CN" : "en_US", false)
}

export function locale(): LocaleCode {
  return current
}

/** Translate one chrome string; missing keys fall back to the English source. */
export function t(source: string, params?: Record<string, string | number>): string {
  const catalogue = CATALOGUES[current]
  let text = catalogue?.[source] ?? source
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}

const ZH_CN: Record<string, string> = {
  // -- top bar / chrome ----------------------------------------------------
  Undo: "撤销",
  Redo: "恢复",
  "Save As": "另存为",
  "working…": "处理中…",
  "Skill Simulation": "技能模拟",
  "Skill simulation is under construction": "技能模拟功能开发中，敬请期待",
  "Implant Simulation": "植入体模拟",
  "Custom": "自定义",
  "In game": "游戏内",
  "Pull from EVE": "从 EVE 拉取",
  "Re-pull the implants this pilot's clone carries in game": "重新拉取该角色克隆体当前携带的植入体",
  "Implant slot": "植入体槽位",
  "EVE reports no implants on this pilot's current clone": "EVE 显示该角色的当前克隆体没有植入体",
  "EVE reports {count} implant(s) on this pilot's current clone":
    "EVE 显示该角色的当前克隆体携带 {count} 个植入体",
  "No implants yet — pull from EVE or pick one on the left":
    "暂无植入体 — 可从 EVE 拉取，或从左侧选择",
  "No implants yet — pick one on the left": "暂无植入体 — 从左侧选择",
  "Available implants": "可用植入体",
  "Implanted": "已植入",
  "All slots": "全部槽位",
  "Slot {slot}": "槽位 {slot}",
  "Already implanted": "已植入",
  "Add this implant": "添加该植入体",
  "No implants available": "没有可用的植入体",
  "Search implants…": "搜索植入体…",
  "No matching implants": "没有匹配的植入体",
  "Other implants": "其他植入体",
  "Ocular Filter": "视觉滤镜",
  "Memory Augmentation": "记忆增强体",
  "Neural Boost": "神经增效体",
  "Cybernetic Subprocessor": "脑控次处理器",
  "Social Adaptation Chip": "社交适应芯片",
  "{count} implants": "{count} 个植入体",
  "Preset implants are simulation-only and stay with this account":
    "预设角色的植入体仅用于模拟，保存在本账号中",
  "the login does not include permission to read implants; sign out and sign in with EVE again to approve it":
    "当前登录未授权读取植入体；请退出后重新用 EVE 登录并同意该权限",
  "This character has no stored EVE login to read implants with.":
    "该角色没有可用于读取植入体的 EVE 登录信息。",
  "Sign out": "退出登录",
  "Sign in with EVE": "使用 EVE 登录",
  "Sign in to continue": "请先登录",
  Cancel: "取消",
  Close: "关闭",
  Delete: "删除",
  "This needs a login.": "此操作需要登录。",
  "No fit open": "未打开装配",
  "Pick a ship on the left, then open one of its fits or create a new one.":
    "在左侧选择舰船，然后打开已有装配或新建一个。",
  "gamedata build {build}": "游戏数据版本 {build}",
  "Interface language": "界面语言",
  Character: "角色",

  // -- layout tabs (eveship.fit style) --------------------------------------
  "Hull & Fits": "舰船与装配",
  Hardware: "硬件",
  Ships: "舰船",
  Fit: "装配",
  Stats: "统计",
  Items: "物品",

  // -- banner ---------------------------------------------------------------
  "EVEShip.fit - View, Create, and Share your EVE Online ship fits online":
    "EVEShip.fit - 在线查看、创建和分享你的 EVE Online 舰船装配",

  // -- ship browser ----------------------------------------------------------
  "Search ships…": "搜索舰船…",
  "Results ({count})": "搜索结果（{count}）",
  "New fit": "新建装配",
  "Delete this fit?": "确定删除该装配？",
  "Delete fitting": "删除装配方案",
  "Delete '{name}'?": "确定删除装配方案「{name}」？",
  "Delete '{name}' from the website and from EVE?":
    "确定删除装配方案「{name}」吗？该方案将同时从网站和 EVE 游戏中删除。",
  "Delete from the website and from EVE": "从网站和 EVE 中删除",
  "Click again to confirm": "再次点击确认",
  "No saved fits yet": "暂无保存的装配",
  "Import my EVE fits": "导入我的 EVE 装配",
  "importing…": "导入中…",
  "reading fits…": "正在读取装配…",
  "Imported {count} fits from {name}": "已从 {name} 导入 {count} 个装配",
  "{count} were already in pyfa": "{count} 个装配已在 pyfa 中",
  "{count} are for ships this game data does not know": "{count} 个装配的舰船不在当前游戏数据中",
  "{count} could not be read": "{count} 个装配无法读取",
  "EVE has no fitting saved for {name}": "EVE 中 {name} 没有保存的装配",
  "This fit was deleted": "该装配已删除",
  "This fit was deleted from the website and from EVE": "该装配已从网站和 EVE 中删除",
  "Delete this fit from the website and from EVE?": "确定从网站和 EVE 中删除该装配吗？",
  "The fit was saved as a new fit": "该装配已另存为新装配",
  "Fit cleared": "装配已清空",

  // -- racks ----------------------------------------------------------------
  "High power": "高槽",
  "Medium power": "中槽",
  "Low power": "低槽",
  "Rig slot": "改装件",
  Subsystem: "子系统",
  Service: "服务槽",
  Mode: "模式",
  "Tactical Mode": "战术模式",
  "Switch tactical mode": "切换战术模式",
  System: "系统",
  "group weapons": "武器编组",
  "ungroup weapons": "取消编组",
  "Ungroup: every weapon goes back to being on its own": "取消编组：每个武器恢复独立操作",
  "Group the same weapons in this rack so one click or charge reaches them all":
    "将本排架相同武器编为一组，一次点击或装弹即可作用于全部",
  "Ship bonuses": "舰船加成",
  Drones: "无人机",
  Fighters: "战斗机",
  Cargo: "货舱",
  Implants: "植入体",
  Boosters: "增效剂",
  Remove: "移除",
  "Ship stats": "舰船统计",
  "Click an item in the browser below to fit it. Charges go into the selected module. Click a row of the fit to inspect it as fitted.":
    "点击下方浏览器中的物品以装配。弹药装入选中的模块。点击装配中的一行以查看其装配后的属性。",

  // -- module states --------------------------------------------------------
  offline: "离线",
  online: "在线",
  active: "激活",
  overheated: "过载",
  "{state} — click to cycle, right-click to overheat": "{state} — 单击切换状态，右键过载",
  "{state} — click to cycle": "{state} — 单击切换状态",
  " · the whole weapon group moves together": " · 整个武器编组将一起切换",

  // -- statistics -----------------------------------------------------------
  Capacitor: "电容",
  Firepower: "火力",
  Tank: "防御",
  Offense: "火力",
  Defense: "防御",
  Navigation: "导航",
  Resistances: "抗性",
  Targeting: "锁定",
  Resources: "资源",
  CPU: "CPU",
  Powergrid: "电网",
  Calibration: "校准",
  "Turret hardpoints": "炮台硬点",
  "Launcher hardpoints": "发射器硬点",
  "Drone bandwidth": "无人机带宽",
  "Drone bay": "无人机挂舱",
  "Cargo capacity": "货舱容量",
  Shield: "护盾",
  Armor: "装甲",
  Hull: "结构",
  EM: "电磁",
  Thermal: "热能",
  Kinetic: "动能",
  Explosive: "爆炸",
  EHP: "有效生命",
  DPS: "DPS",
  // -- module hover card ---------------------------------------------------------
  Range: "射程",
  Cycle: "射击间隔",
  "Capacitor neutralized": "能量中和",
  "Capacitor drained (nos)": "能量吸取",
  "Capacitor transferred": "能量传输",
  "Armor repaired": "装甲维修",
  "Shield boosted": "护盾回充",
  "Hull repaired": "结构修复",
  "Remote armor repaired": "远程装甲维修",
  "Remote shield boosted": "远程护盾回充",
  "Remote hull repaired": "远程结构修复",
  "No direct effect": "无直接效果",
  "Active module": "主动装备",
  "Capacitor restored": "电容回充",
  "Every {cycle} s · {amount} GJ": "每 {cycle} 秒 · {amount} GJ",
  "Tracking speed": "跟踪速度",
  "Optimal range": "最佳射程",
  "Falloff range": "失准范围",
  "Scan resolution": "扫描分辨率",
  "Lock range": "锁定距离",
  "Signature radius": "信号半径",
  "Warp disruption": "跃迁干扰",
  "Target speed": "目标速度",
  "Velocity bonus": "速度加成",
  Volley: "齐射",
  "Weapon DPS": "武器 DPS",
  "Drone DPS": "无人机 DPS",
  "Effective HP": "有效生命值",
  Repair: "维修",
  Sustained: "持续",
  Stable: "稳定",
  Recharge: "回充",
  Delta: "变化率",
  Capacity: "容量",
  Used: "已用",
  Total: "总计",

  // -- hardware browser ------------------------------------------------------
  "Search items…": "搜索物品…",
  market: "市场",
  everything: "全部",
  implants: "植入体",
  high: "高槽",
  med: "中槽",
  low: "低槽",
  rig: "改装件",
  subsystem: "子系统",
  service: "服务槽",
  "Add to fit": "装入装配",
  "Load into selected module": "装入选中的模块",
  "Load into all that fit": "装入所有可装的模块",
  Attributes: "属性",
  Charges: "弹药",
  Variations: "变体",
  "Skills required": "技能需求",
  "Modified by fit": "装配修正后",
  "Base value": "基础值",
  "No fitted module can load this charge": "当前装配中没有模块可以装填该弹药",
  "Loaded into {count} modules": "已装入 {count} 个模块",
  "Exported {name} as text": "已将 {name} 导出为文本",
  "Saved '{name}' to {character} in EVE": "已将 '{name}' 保存到 EVE 中的 {character}",

  // -- import / export dialog -------------------------------------------------
  "Import / Export": "导入 / 导出",
  "Import fit text": "导入装配文本",
  "Paste an EFT, DNA, Smiley, XML or ESI fit below, or pick a file":
    "在下方粘贴 EFT、DNA、Smiley、XML 或 ESI 装配文本，或选择文件",
  Import: "导入",
  "Export as": "导出为",
  EFT: "EFT",
  DNA: "DNA",
  Smiley: "Smiley",
  XML: "XML",
  "EFS JSON": "EFS JSON",
  "ESI JSON": "ESI JSON",
  "Loaded charges": "已装填弹药",
  "Formatting tags": "格式化标签",
  Download: "下载",
  "Downloaded {filename}": "已下载 {filename}",
  "Copy to clipboard": "复制到剪贴板",
  "Copied to clipboard": "已复制到剪贴板",
  "Could not copy to the clipboard": "无法复制到剪贴板",
  "Export backup": "导出备份",
  "Restore backup": "恢复备份",
  "Paste the backup XML below, or pick a file": "在下方粘贴备份 XML，或选择文件",
  "Backup restored {count} fit(s)": "已从备份恢复 {count} 个装配",
  "Imported {count} fit(s)": "已导入 {count} 个装配",

  // -- errors / refused edits ------------------------------------------------
  "the engine refused to run '{command}'; the item may not fit, or the target is invalid":
    "引擎拒绝执行 '{command}'；物品可能不适用，或目标无效。",
  "there is no item with id {itemId} in the game data": "游戏数据中没有 id 为 {itemId} 的物品。",
  "'{name}' is ammunition ({group}), not a module: load it into a fitted module instead":
    "'{name}' 是弹药（{group}），不是模块：请将其装入已装配的模块。",
  "'{name}' is a {group}, not a module, so it cannot go into a slot":
    "'{name}' 属于 {group}，不是模块，不能装入槽位。",
  "'{name}' has no slot to fit into": "'{name}' 没有可装配的槽位。",
  "the fit has no free {rack} slot for '{name}'": "该装配没有空的{rack}槽位可容纳 '{name}'。",
  "'{name}' is restricted to certain hulls and cannot be fitted to a {ship}":
    "'{name}' 仅限特定船体，无法装配到 {ship}。",
  "'{name}' is a capital-size module and is too big for a {ship}":
    "'{name}' 是旗舰级模块，对 {ship} 来说太大。",
  "'{name}' is the wrong size for the rig slots of a {ship}": "'{name}' 的尺寸与 {ship} 的改装件槽不匹配。",
  "the fit has no free {hardpoint} hardpoint for '{name}'": "该装配没有空的{hardpoint}硬点可容纳 '{name}'。",
  "'{name}' does not fit this fit": "'{name}' 无法装入该装配。",
  "'{name}' is already {state}": "'{name}' 已经是{state}状态。",
  "undo failed; the fit may have changed underneath": "撤销失败；装配可能已被其他操作改变。",
  "redo failed; the fit may have changed underneath": "恢复失败；装配可能已被其他操作改变。",
  "'{name}' needs {needed} Mbit/s of drone bandwidth; this fit has {available} of {total} left":
    "'{name}' 需要 {needed} Mbit/s 无人机带宽，本装配只剩 {available}/{total}。",
  "the ship can keep {limit} drones in space at once and {active} already are":
    "该舰最多同时放出 {limit} 架无人机，当前已有 {active} 架。",
  Bandwidth: "带宽",
  "No drone bandwidth left": "无人机带宽不足",
  "The ship cannot keep more drones in space": "该舰无法同时控制更多无人机",
  "this account has no {server} EVE login stored on the server; sign in with EVE again":
    "服务器上没有该账号的 {server} EVE 登录信息；请重新使用 EVE 登录。",
  "EVE no longer accepts the stored login; sign in with EVE again": "EVE 不再接受已保存的登录；请重新登录。",
  "EVE's ESI could not be reached; try again in a moment": "无法连接 EVE 的 ESI 服务，请稍后再试。",
  "EVE refused to hand over the fittings ({reason})": "EVE 拒绝提供装配列表（{reason}）。",
  "EVE did not answer with a list of fittings, so none were imported": "EVE 未返回装配列表，未导入任何装配。",
  "the fittings could not be imported; the server log has the reason": "无法导入装配；原因见服务器日志。",
  "the fit to export was not found; it may have been deleted": "要导出的装配未找到；可能已被删除。",
  "the fit has nothing fitted, so there is nothing to export": "该装配没有内容，无可导出。",
  "EVE refused to save the fitting ({reason})": "EVE 拒绝保存装配（{reason}）。",
  "the fitting could not be exported; the server log has the reason": "无法导出装配；原因见服务器日志。",
  "this fit came in before the web kept its in-game id; delete it in the game first, then here":
    "该装配早于网站记录游戏内 id 的功能；请先在游戏中删除，再在此删除。",
  "EVE refused to delete the fitting ({reason}); nothing was deleted": "EVE 拒绝删除装配（{reason}）；未删除任何内容。",
  "this fit is not saved in EVE, so there is nothing to delete from the game":
    "该装配未保存在 EVE 中，无法从游戏删除。",
  "the import text could not be read; check the format and try again": "无法读取导入文本，请检查格式后重试。",
  "no importable fit format was recognised in that text": "未能识别该文本中的装配格式。",
  "the fit refused the imported items; nothing was applied": "当前装配拒绝了导入的物品，未做任何更改。",
  "that export format is not available for this fit": "该导出格式不适用于此装配。",

  // -- SSO ---------------------------------------------------------------------
  "Importing your EVE fits reads them from EVE as you, so it needs a login first.":
    "导入 EVE 装配需要以你的身份向 EVE 读取，请先登录。",
  "Exporting a fit to your EVE character needs a login first.": "把装配保存到你的 EVE 角色需要先登录。",
  "EVE SSO is not configured on this server.": "此服务器未配置 EVE SSO。",
  "Set PYFA_WEB_SSO_CLIENT_ID, or run the server with --dev-login for development.":
    "请设置 PYFA_WEB_SSO_CLIENT_ID，或在开发时用 --dev-login 启动服务器。",
  "the sign-in took too long or was already used; start again": "本次登录已超时或已被使用，请重新登录。",
  "the sign-in was cancelled at EVE": "已在 EVE 取消登录。",
  "EVE's login service could not be reached; try again in a moment": "无法连接 EVE 登录服务，请稍后再试。",
  "EVE did not accept the sign-in; the server log has the reason": "EVE 未接受本次登录，原因见服务器日志。",
  "the sign-in did not complete": "登录未完成。",

  // -- fit sharing -------------------------------------------------------------
  "Share this fit": "分享该装配",
  "Fit share URL copied": "装配分享链接已复制",
  "Imported shared fit": "已导入分享的装配",

  // -- eveship.fit tree / hardware (Hull & Fits / Hardware tabs) ---------------
  Search: "搜索",
  "Filter: Browser-stored fittings": "筛选：浏览器本地装配",
  "Filter: in-game personal fittings": "筛选：游戏内个人装配",
  "CCP didn't implement this ESI endpoint (yet?)": "CCP 尚未实现该 ESI 端点（也许以后会）。",
  "Filter: current hull": "筛选：当前舰船",
  "No Item": "无项目",
  "Browser-stored fitting": "浏览器本地装配",
  "In-game personal fitting": "游戏内个人装配",
  "Filter: Low Slot": "筛选：低槽",
  "Filter: Mid Slot": "筛选：中槽",
  "Filter: High Slot": "筛选：高槽",
  "Filter: Rig & Subsystem Slots": "筛选：改装件与子系统槽",
  "Filter: Drones": "筛选：无人机",
  "Filter: Fitted Weapons": "筛选：已装配武器",
  Equipment: "装备",
  "No fitted equipment can load charges": "当前装配没有可装填弹药的装备",
  "Click to show only the charges it can load": "点击只显示它能装填的弹药",
  "{weapon} · loaded: {charge}": "{weapon} · 已装：{charge}",
  "This weapon loads nothing from this list": "该武器没有可装填的弹药",
  "Type to search for equipment and charges": "输入关键词搜索装备与弹药",
  "Drop here to fit": "拖放到这里进行装配",
  "Drop a ship here to create a fit, or drag a fit here to open it": "将舰船拖到这里新建装配，或将已有装配拖到这里打开",
  "share fit": "分享装配",
  "copied to clipboard": "已复制到剪贴板",

  // -- radial fit panel ----------------------------------------------------------
  Name: "名称",
  "Power Grid": "电力栅格",
  "Simulation History": "模拟历史",
  Preview: "预览",
  "Remove Charge": "卸下弹药",
  "Unfit Module": "卸下模块",
  "Put Offline": "设为离线",

  // -- fit button bar ------------------------------------------------------------
  Save: "保存",
  "Saved a copy as {name}": "已保存副本：{name}",
  Clipboard: "剪贴板",
  "In Clipboard": "已在剪贴板",
  "Import from Clipboard": "从剪贴板导入",
  "Copy to Clipboard": "复制到剪贴板",
  "Advanced Import/Export…": "高级导入/导出…",
  "Share Link": "分享链接",
  "Save to EVE": "写入游戏",
  Rename: "重命名",
  "Fit Name": "装配名称",
  "Paste your fit here": "在此粘贴你的装配",
  "Tip: drag cargo items onto a slot to fit them": "提示：把货舱物品拖到槽位上即可装配",
  "Tip: drag cargo items onto the ship to fit them": "提示：把货舱物品拖到舰船上即可装配",
  "Tip: drag drones to the ship to add them": "提示：把无人机拖到舰船即可放入无人机舱",

  // -- statistics ----------------------------------------------------------------
  "Estimated Price": "估价",
  "Total estimated market value": "市场估价合计",
  Ship: "船体",
  Fittings: "装备",
  "Cargo bay": "货舱",
  "Refresh prices": "刷新价格",
  "Updating prices...": "正在更新价格…",
  "Fetch current market prices": "从市场数据源获取最新价格",
  "Prices unavailable": "暂时无法获取市场价格",
  " · {count} no price": " · {count} 项无价",

  // -- ship bonuses & insurance --------------------------------------------------
  Insurance: "保险",
  "Insurance value": "保险基准值",
  "No market price": "暂无市价",
  Level: "等级",
  Premium: "保费",
  Payout: "赔付",
  "No insurance": "不投保",
  Basic: "基础",
  Standard: "标准",
  Bronze: "青铜",
  Silver: "白银",
  Gold: "黄金",
  Platinum: "铂金",
  "Defaults to the hull's market price. CCP pays a share of what the hull costs to build, which is lower, so type the 100% payout from the in-game insurance window to make these exact.":
    "基准值默认为船体市价。CCP 实际按建造材料成本计算（低于市价），填入游戏内保险窗口显示的 100% 赔付值即可精确换算。",

  "Depletes in": "耗尽于",
  "Damage Per Second": "每秒伤害",
  "Alpha Strike": "齐射伤害",
  "Armor repair rate": "装甲维修速率",
  "Hull repair rate": "船体维修速率",
  "Passive shield recharge": "被动护盾回充",
  "Shield boost rate": "护盾增强速率",
  "No Module": "无模块",
  "Scan Strength": "扫描强度",
  "Scan Resolution": "扫描分辨率",
  "Signature Radius": "信号半径",
  "Maximum Locked Targets": "最大锁定目标数",
  Mass: "质量",
  "Inertia Modifier": "惯性修正系数",
  "Ship Warp Speed": "舰船跃迁速度",
  "Align Time": "起跳时间",
  "Drone Bandwidth": "无人机带宽",
  "Drone Control Range": "无人机控制距离",
  Active: "已激活",
  "Mbit/sec": "兆比特/秒",
  points: "点",
  "Kindly hosted by": "由以下机构友情托管",
  "Cargo is empty": "货舱为空",
  "Drag to a slot or to the ship": "拖到槽位或舰船上",
  "Drag to the ship to fit": "拖到舰船上进行装配",
  "No drones in the bay": "无人机舱内没有无人机",
  "Active drones": "已激活无人机",
  Selected: "已选择",
  Deactivate: "收回",
  Activate: "放出",

  // -- skills sidebar --------------------------------------------------------
  Skills: "技能",
  "Collapse skills": "收起技能面板",
  "Expand skills": "展开技能面板",
  "{missing}/{total} missing": "缺 {missing}/{total}",
  "Hide trained skills": "隐藏已满足的技能",
  "Show trained skills": "显示已满足的技能",
  "Hide trained": "隐藏已会",
  "Show trained": "显示已会",
  "Required / current level": "需求等级 / 当前等级",
  "Required level": "需求等级",
  "Current level": "当前等级",
  "{label}: level {level}": "{label}：{level} 级",
  Prerequisite: "前置",
  "Open a fit to see its skills": "打开一个装配即可查看相关技能",
  "Loading…": "加载中…",
  "Failed to load skills": "技能加载失败",
  "All skills trained": "所有技能均已满足",
  "This fit needs no skills": "该装配无需技能",
  "Required skills": "需求技能",
  "Custom skills": "自定义技能",
  "Skills you added yourself; the fit character's current level is shown":
    "自行添加的技能，仅显示当前角色的学习等级",
  "Add skill": "添加技能",
  "Search skills…": "搜索技能…",
  "Searching…": "搜索中…",
  "No skills found": "未找到技能",
  "Remove custom skill": "移除自定义技能",
  Edit: "编辑",
  Done: "完成",
  Reset: "重置",
  "Edit skill levels": "编辑技能等级",
  "Finish editing skill levels": "结束技能等级编辑",
  "Reset simulated levels to the character's saved skills": "将模拟的技能等级重置为角色已保存的技能表",
  "Set level {level}": "设为 {level} 级",
  "Simulated level, not saved": "模拟等级，未保存",
  "Click a level box to simulate the trained rank; Reset restores the saved sheet":
    "点击等级格子模拟学习等级；重置可恢复已保存的技能表",
  "Switching…": "切换中…",
  "Switch to {name}": "切换到 {name}",
  "No pilot": "无可编辑角色",
  "Sign in to edit": "登录后可编辑",
  "Bind this fit to {name} so skill levels can be edited":
    "将此装配绑定到 {name} 后即可编辑技能等级",
  "The All 0 / All 5 presets are read-only; sign in to edit skill levels":
    "All 0 / All 5 为只读预设；登录后即可编辑技能等级",
  "Read-only skill preset — switch to your pilot to edit levels":
    "当前为只读技能预设，切换到你的角色即可编辑等级",
}

const CATALOGUES: Partial<Record<LocaleCode, Record<string, string>>> = { zh_CN: ZH_CN }

