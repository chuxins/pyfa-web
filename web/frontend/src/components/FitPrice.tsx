import React from "react"
import { api, type FitPrice } from "../api"
import { formatIsk } from "../format"
import { t } from "../i18n"
import { useFittingStore } from "../store/fitting"

const PRICE_AUTOREFRESH_KEY = "pyfa.priceAutorefreshedFit"

/** The five subtotal buckets the desktop price view shows, plus the total. */
const BUCKETS: { key: keyof Omit<FitPrice["totals"], "total">; label: string }[] = [
  { key: "ship", label: "Ship" },
  { key: "fittings", label: "Fittings" },
  { key: "drones", label: "Drones" },
  { key: "cargoBay", label: "Cargo bay" },
  { key: "character", label: "Character" },
]

/**
 * Fit market valuation, drawn as the last collapsible category of the right-hand
 * statistics column. Prices come from the same source pyfa desktop uses
 * (fuzzwork, Jita sell-order percentile by default), cached per user for 24h.
 *
 * The first open of a fit with no cached rows triggers one background fetch so
 * the panel is not stuck on zeros; later refreshes are manual to stay quiet.
 */
export const FitPricePanel = () => {
  const fit = useFittingStore((state) => state.fit)
  const [price, setPrice] = React.useState<FitPrice | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  const [expanded, setExpanded] = React.useState(true)

  const fitId = fit?.id

  const load = React.useCallback(async (fitId: number, force: boolean) => {
    setLoading(true)
    setError("")
    try {
      const result = force
        ? await api.refreshFitPrice(fitId)
        : await api.fitPrice(fitId)
      setPrice(result.fitId === fitId ? result : null)
    } catch (err) {
      // A missing/offline market source must never blank the statistics column.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    setPrice(null)
    setError("")
    if (fitId === undefined) return

    let cancelled = false
    void (async () => {
      setLoading(true)
      setError("")
      try {
        const cached = await api.fitPrice(fitId)
        if (cancelled) return
        setPrice(cached)
        // One automatic fetch per fit per browser session, only when the cache
        // cannot answer yet (never priced, or every cached row stale/missing).
        const alreadyFetched = window.sessionStorage.getItem(PRICE_AUTOREFRESH_KEY) === String(fitId)
        if ((cached.updating || cached.missingCount > 0) && !alreadyFetched) {
          try {
            window.sessionStorage.setItem(PRICE_AUTOREFRESH_KEY, String(fitId))
            const fresh = await api.refreshFitPrice(fitId)
            if (!cancelled) setPrice(fresh)
          } catch {
            // Keep the cached/no-data view; the manual refresh button retries.
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fitId])

  if (fitId === undefined) return null

  const totals = price?.totals

  return (
    <div className="statPanel statPrice">
      <div className="statHeader">
        <div onClick={() => setExpanded((current) => !current)}>{t("Estimated Price")}</div>
        <div style={{ textAlign: "right" }} onClick={() => setExpanded((current) => !current)}>
          {totals ? (
            <span title={t("Total estimated market value")}>{formatIsk(totals.total)}</span>
          ) : loading ? (
            <span className="statPriceStatus">{t("Updating prices...")}</span>
          ) : (
            <span className="statPriceStatus">--</span>
          )}
        </div>
      </div>
      <div className={expanded ? "statExpanded statPriceExpanded" : "statCollapsed"}>
        {BUCKETS.map((bucket) => (
          <div className="statLine" key={bucket.key}>
            <span>{t(bucket.label)}</span>
            <span style={{ textAlign: "right" }}>{totals ? formatIsk(totals[bucket.key]) : "--"}</span>
          </div>
        ))}
        <div className="statLine statPriceTotalLine">
          <span>{t("Total")}</span>
          <span style={{ textAlign: "right" }}>{totals ? formatIsk(totals.total) : "--"}</span>
        </div>
        <div className="statPriceFooter">
          <button
            type="button"
            className="statPriceRefresh"
            disabled={loading}
            onClick={() => void load(fitId, true)}
            title={t("Fetch current market prices")}
          >
            {loading ? t("Updating prices...") : t("Refresh prices")}
          </button>
          {price && (
            <span className="statPriceMeta">
              {price.region} · {price.source}
              {price.missingCount > 0 && t(" · {count} no price", { count: price.missingCount })}
            </span>
          )}
        </div>
        {error && <div className="banner-error statPriceError">{t("Prices unavailable")}</div>}
      </div>
    </div>
  )
}
