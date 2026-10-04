"""Chart endpoints: pyfa's graph data layer, serialised for the browser.

Three reads only -- list the graphs, ask for curve data, ask for one point -- so
the whole thing is a normal ``GET`` under the same per-user engine binding every
other endpoint runs with (see :mod:`web.deps`). No state is stored server-side:
each request instantiates the requested ``FitGraph`` fresh, which is cheap
enough (the smoothing cache is per-instance and there is nothing to reuse
between requests for different users' private databases).
"""

import json

from fastapi import APIRouter, HTTPException, Query
from logbook import Logger

from web.services import graphs as graphService

pyfalog = Logger(__name__)

router = APIRouter(prefix="/fits/{fit_id}/graphs", tags=["graphs"])


def _require_fit(fit_id):
    from service.fit import Fit

    fit = Fit.getInstance().getFit(fit_id)
    if fit is None:
        raise HTTPException(status_code=404, detail="fit not found")
    return fit


def _parse_json(value, name):
    if value is None or value == "":
        return None
    try:
        data = json.loads(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="{} must be a JSON object".format(name))
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="{} must be a JSON object".format(name))
    return data


def _parse_range(value):
    if value is None or value == "":
        return None
    parts = value.replace("-", ",").split(",")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="range must be 'low,high'")
    try:
        low, high = float(parts[0]), float(parts[1])
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="range must be numeric")
    if low >= high:
        raise HTTPException(status_code=400, detail="range low must be below high")
    return (low, high)


@router.get("")
def list_graphs(fit_id: int):
    return graphService.list_graphs(_require_fit(fit_id))


@router.get("/{graph_id}/plot")
def get_plot(
    fit_id: int,
    graph_id: str,
    x: str | None = Query(None),
    y: str | None = Query(None),
    range: str | None = Query(None, alias="range"),
    inputs: str | None = Query(None),
    checkboxes: str | None = Query(None),
    vectors: str | None = Query(None),
    tgt: str | None = Query(None),
    ammoStyle: str | None = Query(None),
    ammoQuality: str | None = Query(None),
):
    fit = _require_fit(fit_id)
    try:
        return graphService.build_plot(
            fit, graph_id,
            x=x,
            y=y,
            x_range=_parse_range(range),
            inputs=_parse_json(inputs, "inputs"),
            checkboxes=_parse_json(checkboxes, "checkboxes"),
            vectors=_parse_json(vectors, "vectors"),
            tgt=tgt,
            ammo_style=ammoStyle,
            ammo_quality=ammoQuality,
        )
    except KeyError as ex:
        raise HTTPException(status_code=404, detail=str(ex))
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.get("/{graph_id}/point")
def get_point(
    fit_id: int,
    graph_id: str,
    at: float = Query(..., description="x position to evaluate"),
    x: str | None = Query(None),
    y: str | None = Query(None),
    range: str | None = Query(None, alias="range"),
    inputs: str | None = Query(None),
    checkboxes: str | None = Query(None),
    vectors: str | None = Query(None),
    tgt: str | None = Query(None),
    ammoQuality: str | None = Query(None),
):
    fit = _require_fit(fit_id)
    try:
        return graphService.build_point(
            fit, graph_id,
            at=at,
            x=x,
            y=y,
            x_range=_parse_range(range),
            inputs=_parse_json(inputs, "inputs"),
            checkboxes=_parse_json(checkboxes, "checkboxes"),
            vectors=_parse_json(vectors, "vectors"),
            tgt=tgt,
            ammo_quality=ammoQuality,
        )
    except KeyError as ex:
        raise HTTPException(status_code=404, detail=str(ex))
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
