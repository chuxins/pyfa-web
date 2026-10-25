import React from "react"
import { api, type FitPrice } from "../api"
import { formatIsk } from "../format"
import { t } from "../i18n"
import { useFittingStore } from "../store/fitting"

/**
 * EVE's insurance ladder.
 *
 * Both columns are percentages of the hull's *insurance value* -- CCP's own estimate
 * of what the hull costs to build, which it keeps private and which sits below the
 * market price of the finished hull. The payout column is the published one (an
 * uninsured loss still pays 40%, platinum pays the whole value); the premium column
 * follows the same base, 5% of it per step from basic to platinum, which is what the
 * in-game window charges (see EVE University's "Insurance", 2023).
 */
const LEVELS: { label: string; premium: number; payout: number }[] = [
  { label: "No insurance", premium: 0, payout: 40 },
  { label: "Basic", premium: 5, payout: 50 },
  { label: "Standard", premium: 10, payout: 60 },
  { label: "Bronze", premium: 15, payout: 70 },
  { label: "Silver", premium: 20, payout: 80 },
  { label: "Gold", premium: 25, payout: 90 },
  { label: "Platinum", premium: 30, payout: 100 },
]

/** A hull's hand-entered insurance value, kept per ship type in the browser alone. */
const STORAGE_PREFIX = "pyfa.insuranceValue."

function storedValue(shipTypeId: number | undefined): number | null {
  if (shipTypeId === undefined) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + shipTypeId)
    const value = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function rememberValue(shipTypeId: number | undefined, value: number | null) {
  if (shipTypeId === undefined) return
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_PREFIX + shipTypeId)
    else window.localStorage.setItem(STORAGE_PREFIX + shipTypeId, String(value))
  } catch {
    // Private mode, or storage turned off: the value stands for this page only
  }
}

/**
 * Insurance payout and premium per level, drawn under the market valuation because
 * both answer "what is this hull worth to me".
 *
 * The value the percentages apply to is CCP's, so it cannot be read from anywhere:
 * the panel starts from the hull's cached market price and lets the number be typed
 * in -- paste the 100% payout the in-game insurance window offers for the hull and
 * every row becomes exact.
 */
export const InsurancePanel = () => {
  const fit = useFittingStore((state) => state.fit)
  const [expanded, setExpanded] = React.useState(true)
  const [market, setMarket] = React.useState<number | null>(null)
  const [typed, setTyped] = React.useState("")

  const fitId = fit?.id
  const shipTypeId = fit?.ship?.id

  // The hull's cached market price, the default the input offers
  React.useEffect(() => {
    setMarket(null)
    if (fitId === undefined || shipTypeId === undefined) return
    let cancelled = false
    let tries = 0

    const read = async () => {
      if (cancelled) return
      try {
        const price: FitPrice = await api.fitPrice(fitId)
        if (cancelled) return
        const line = price.lines.find((row) => row.itemId === shipTypeId)
        const unit = line?.unitPrice ?? null
        setMarket(unit)
        // The valuation panel fetches prices in the background the first time a fit
        // is opened, so a hull with nothing cached yet gets an answer a moment later.
        if (unit === null && tries < 3) {
          tries += 1
          window.setTimeout(() => void read(), 3000)
        }
      } catch {
        if (!cancelled) setMarket(null)
      }
    }

    void read()
    return () => {
      cancelled = true
    }
  }, [fitId, shipTypeId])

  // A value typed for this hull wins over the market price
  React.useEffect(() => {
    const stored = storedValue(shipTypeId)
    setTyped(stored === null ? "" : String(stored))
  }, [shipTypeId])

  if (fitId === undefined) return null

  const parsed = Number(typed)
  const manual = typed.trim() !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : null
  const base = manual ?? market

  const onValue = (value: string) => {
    setTyped(value)
    const next = Number(value)
    rememberValue(shipTypeId, value.trim() !== "" && Number.isFinite(next) && next > 0 ? next : null)
  }

  const amount = (percent: number): string =>
    base === null ? "--" : formatIsk((base * percent) / 100)

  return (
    <div className="statPanel statInsurance">
      <div className="statHeader" onClick={() => setExpanded((current) => !current)}>
        <div>{t("Insurance")}</div>
        <div style={{ textAlign: "right" }}>{base === null ? "--" : formatIsk(base)}</div>
      </div>
      <div className={expanded ? "statInsuranceExpanded" : "statCollapsed"}>
        <div className="statLine statInsuranceValue">
          <span>{t("Insurance value")}</span>
          <input
            type="text"
            inputMode="decimal"
            value={typed}
            placeholder={market === null ? t("No market price") : formatIsk(market)}
            onChange={(e) => onValue(e.target.value)}
            aria-label={t("Insurance value")}
          />
        </div>

        <div className="statLine statInsuranceHead">
          <span>{t("Level")}</span>
          <span>{t("Premium")}</span>
          <span>{t("Payout")}</span>
        </div>

        {LEVELS.map((level) => (
          <div className="statLine" key={level.label}>
            <span>
              {t(level.label)} <span className="dim">{level.payout}%</span>
            </span>
            <span>{level.premium === 0 ? "\u2013" : amount(level.premium)}</span>
            <span>{amount(level.payout)}</span>
          </div>
        ))}

        <div className="statInsuranceNote">
          {t(
            "Defaults to the hull's market price. CCP pays a share of what the hull costs to build, which is lower, so type the 100% payout from the in-game insurance window to make these exact.",
          )}
        </div>
      </div>
    </div>
  )
}
