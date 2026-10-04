"""Headless chart service: pyfa's graph data layer as JSON.

The desktop graphs window (``graphs/gui/``) is wx + matplotlib and cannot run on
the server. Everything underneath it -- the ``FitGraph`` declarations, the
``PointGetter`` calculations, ammo optimisation, recursive smoothing -- lives in
``graphs/data/`` and is GUI-free, so this module drives it directly: it builds
the same ``mainInput`` / ``miscInputs`` / ``src`` / ``tgt`` arguments
``canvasPanel.py`` builds, calls ``getPlotPoints`` / ``getPlotSegments`` /
``getPoint``, and serialises the result for the browser.

``graphs.data`` must not be imported at module import time: it needs the headless
wx shim and the ``gui.mainFrame`` stub, which the engine installs during startup
(``web.engine``). The routers are imported before that, so every graph import is
deferred until the first request, which is always after startup.
"""

import colorsys
import math
from types import SimpleNamespace

from logbook import Logger

pyfalog = Logger(__name__)

_ctx = {}




def list_graphs(fit):
    """All visible graphs with their axes/inputs, plus the targets to plot against.

    ``fit`` is the eos fit the graphs are drawn for; its own target profile (when
    one is set) is offered first, then the saved profiles, then the built-ins.
    """
    ctx = _ensure()
    graphs = []
    for cls in ctx["FitGraph"].views:
        if cls.hidden:
            continue
        view = cls()
        graphs.append(_serialize_view(ctx, view))
    return {
        "graphs": graphs,
        "targets": _list_targets(ctx, fit),
        "defaultTarget": _default_target_spec(fit),
    }


def build_plot(fit, graph_id, *, x=None, y=None, x_range=None, inputs=None,
               checkboxes=None, vectors=None, tgt=None, ammo_style="color",
               ammo_quality="navy"):
    """Curve data for one source fit against one (optional) target."""
    ctx = _ensure()
    view = _instantiate(ctx, graph_id)
    has_segments = getattr(view, "hasSegments", False)
    if has_segments:
        # Same attribute canvasPanel sets before asking for segments
        view._ammoQuality = ammo_quality or "navy"

    x_spec = _resolve_axis(ctx, view, x, which="x")
    y_spec = _resolve_axis(ctx, view, y, which="y")
    src = ctx["SourceWrapper"](fit, next(iter(ctx["BASE_COLORS"])))
    tgt_obj = _resolve_target(ctx, fit, tgt)
    if tgt_obj is None and view.hasTargets:
        tgt_obj = _default_target(ctx, fit)
    if tgt_obj is None and view.hasTargets:
        # A target-dependent graph with no target draws nothing (desktop behaviour)
        return {
            "x": _spec_json(x_spec),
            "y": _spec_json(y_spec),
            "range": list(_main_range(ctx, view, x_spec, [src], x_range)),
            "series": [],
            "warning": "no target",
        }

    main_input, main_def = _build_main(ctx, view, x_spec, [src], x_range)
    misc = _build_misc(ctx, view, x_spec, y_spec, main_def, inputs, checkboxes, vectors)

    base_hsl = ctx["BASE_COLORS"][src.colorID].hsl
    line_type = "solid"
    if tgt_obj is not None:
        base_hsl = ctx["LIGHTNESSES"][tgt_obj.lightnessID].func(base_hsl)
        line_type = _line_type(ctx, tgt_obj.lineStyleID)
    base_rgb = _hsl_to_rgb(base_hsl)

    series = []
    if has_segments:
        get_segments = getattr(view, "getPlotSegments", None)
        if get_segments is not None:
            try:
                segments = get_segments(mainInput=main_input, miscInputs=misc,
                                        xSpec=x_spec, ySpec=y_spec, src=src, tgt=tgt_obj)
            except Exception:
                pyfalog.exception("Failed to get segments for {} vs {}",
                                  src.name, "" if tgt_obj is None else tgt_obj.name)
                segments = None
            if segments:
                series = _segments_to_series(ctx, view, segments, ammo_style,
                                             base_rgb, line_type, src, tgt_obj)

    if not series:
        try:
            xs, ys = view.getPlotPoints(mainInput=main_input, miscInputs=misc,
                                        xSpec=x_spec, ySpec=y_spec, src=src, tgt=tgt_obj)
        except Exception:
            pyfalog.exception("Failed to plot {} vs {}",
                              src.name, "" if tgt_obj is None else tgt_obj.name)
            xs, ys = [], []
        if _valid(xs, ys):
            series.append({
                "name": _series_name(src, tgt_obj),
                "color": _rgb_hex(base_rgb),
                "lineType": line_type,
                "ammo": None,
                "points": [[float(v) for v in pair] for pair in zip(xs, ys)],
            })

    return {
        "x": _spec_json(x_spec),
        "y": _spec_json(y_spec),
        "range": list(main_input.value),
        "series": series,
    }

def _ensure():
    """Import the graph package lazily (engine must be up first); cache the names."""
    if not _ctx:
        import graphs.data  # noqa: F401  (importing registers FitGraph.views)
        from eos.saveddata.targetProfile import TargetProfile
        from graphs.data.base import FitGraph
        from graphs.style import BASE_COLORS, LIGHTNESSES, STYLES, hsl_to_hsv
        from graphs.wrapper import SourceWrapper, TargetWrapper
        from service.const import GraphLightness, GraphLineStyle

        _ctx.update(locals())
    return _ctx


def build_point(fit, graph_id, *, at, x=None, y=None, x_range=None, inputs=None,
                checkboxes=None, vectors=None, tgt=None, ammo_quality="navy"):
    """The y value at one x position (the browser's hover / X-marker readout)."""
    ctx = _ensure()
    view = _instantiate(ctx, graph_id)
    has_segments = getattr(view, "hasSegments", False)
    if has_segments:
        view._ammoQuality = ammo_quality or "navy"

    x_spec = _resolve_axis(ctx, view, x, which="x")
    y_spec = _resolve_axis(ctx, view, y, which="y")
    src = ctx["SourceWrapper"](fit, next(iter(ctx["BASE_COLORS"])))
    tgt_obj = _resolve_target(ctx, fit, tgt)
    if tgt_obj is None and view.hasTargets:
        tgt_obj = _default_target(ctx, fit)
    if tgt_obj is None and view.hasTargets:
        return {"x": at, "y": None}

    main_input, main_def = _build_main(ctx, view, x_spec, [src], x_range)
    misc = _build_misc(ctx, view, x_spec, y_spec, main_def, inputs, checkboxes, vectors)

    result = {"x": at, "y": None}
    get_extended = getattr(view, "getPointExtended", None)
    if get_extended is not None:
        y_value, extra = get_extended(x=at, miscInputs=misc, xSpec=x_spec,
                                      ySpec=y_spec, src=src, tgt=tgt_obj)
        if extra:
            result.update(extra)
    else:
        try:
            y_value = view.getPoint(x=at, miscInputs=misc, xSpec=x_spec,
                                    ySpec=y_spec, src=src, tgt=tgt_obj)
        except Exception:
            pyfalog.exception("Failed to get point at {} for {}", at, graph_id)
            y_value = None
    if y_value is not None:
        result["y"] = float(y_value)
    return result

# ---------------------------------------------------------------------------
# Graph/axis helpers
# ---------------------------------------------------------------------------


def _instantiate(ctx, graph_id):
    cls = ctx["FitGraph"].viewMap.get(graph_id)
    if cls is None:
        raise KeyError("unknown graph '{}'".format(graph_id))
    return cls()


def _resolve_axis(ctx, view, key, which):
    defs = view.xDefs if which == "x" else view.yDefs
    if key is None:
        return next((d for d in defs if not d.hidden), defs[0] if defs else None)
    if ":" not in key:
        raise ValueError("{} axis must be 'handle:unit'".format(which))
    handle, _, unit = key.partition(":")
    unit = unit or None
    dmap = view.xDefMap if which == "x" else view.yDefMap
    spec = dmap.get((handle, unit))
    if spec is None:
        raise ValueError("unknown {} axis '{}'".format(which, key))
    return spec


def _build_main(ctx, view, x_spec, sources, x_range):
    """The main (range) input behind the chosen x axis, plus its def."""
    input_def = view.inputMap[x_spec.mainInput]
    if x_range is not None:
        value = tuple(x_range)
    else:
        getter = getattr(view, "getDefaultInputRange", None)
        if getter is not None:
            dynamic = getter(input_def, sources)
            value = dynamic if dynamic is not None else input_def.defaultRange
        else:
            value = input_def.defaultRange
    return SimpleNamespace(handle=input_def.handle, unit=input_def.unit, value=value), input_def


def _main_range(ctx, view, x_spec, sources, x_range):
    _, input_def = _build_main(ctx, view, x_spec, sources, x_range)
    return input_def.defaultRange if x_range is None else x_range


def _build_misc(ctx, view, x_spec, y_spec, main_def, user_inputs, user_checkboxes, user_vectors):
    """Mirrors ``ctrlPanel.getValues()``: vectors, other inputs, checkboxes."""
    user_inputs = user_inputs or {}
    user_checkboxes = user_checkboxes or {}
    user_vectors = user_vectors or {}
    misc = []
    processed = {main_def.handle}

    def add(handle, unit, value):
        if handle in processed:
            return
        processed.add(handle)
        misc.append(SimpleNamespace(handle=handle, unit=unit, value=value))

    for vector_def in (view.srcVectorDef, view.tgtVectorDef):
        if vector_def is None:
            continue
        direction_only = vector_def.lengthHandle == main_def.handle
        if not direction_only:
            add(vector_def.lengthHandle, vector_def.lengthUnit,
                user_vectors.get(vector_def.lengthHandle, 100))
        add(vector_def.angleHandle, vector_def.angleUnit,
            user_vectors.get(vector_def.angleHandle, 0))

    for input_def in view.inputs:
        if input_def.handle in processed:
            continue
        if not _conditions_ok(input_def, x_spec, y_spec):
            continue
        add(input_def.handle, input_def.unit,
            user_inputs.get(input_def.handle, input_def.defaultValue))

    for checkbox_def in view.checkboxes:
        if checkbox_def.handle in processed:
            continue
        if not _conditions_ok(checkbox_def, x_spec, y_spec):
            continue
        add(checkbox_def.handle, None,
            user_checkboxes.get(checkbox_def.handle, checkbox_def.defaultValue))
    return misc

# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------


def _translate_target_fragment(text):
    """One ``[category]`` or tail of a built-in target profile's display name in
    the server language.

    The built-in profiles are generated once with English text (eos' ``_t`` in
    ``eos/saveddata/targetProfile.py`` is a no-op), so the web runs their
    fragments through pyfa's own locale catalogue; unknown strings pass through
    (a no-op for ``en_US`` and for anything the catalogue has no entry for).
    """
    import wx
    try:
        return wx.GetTranslation(text)
    except Exception:
        return text


def _target_display_name(profile):
    """A target profile's name for the browser, in the server language.

    User profiles are shown exactly as the user typed them. Built-in profiles
    carry English names even under a non-English locale (the desktop shows them
    the same way), so each ``[category]`` and the tail are translated here.
    """
    if not getattr(profile, "builtin", False):
        return profile.fullName
    out = []
    rest = profile.fullName
    while rest:
        start = rest.find("[")
        if start == -1:
            out.append(_translate_target_fragment(rest))
            break
        end = rest.find("]", start + 1)
        if end == -1:
            out.append(rest)
            break
        out.append(rest[:start])
        out.append("[{}]".format(_translate_target_fragment(rest[start + 1:end])))
        rest = rest[end + 1:]
    return "".join(out)


def _list_targets(ctx, fit):
    TargetProfile = ctx["TargetProfile"]
    targets = []
    seen = set()

    def add_profile(profile):
        if profile is None or profile.ID in seen:
            return
        seen.add(profile.ID)
        targets.append({"type": "profile", "id": profile.ID, "name": _target_display_name(profile)})

    own = fit.targetProfile
    if own is not None:
        add_profile(own)
    for profile in _user_profiles():
        add_profile(profile)
    for profile in TargetProfile.getBuiltinList():
        add_profile(profile)
    add_profile(TargetProfile.getIdeal())
    return targets


def _user_profiles():
    import eos.db
    try:
        return eos.db.getTargetProfileList() or []
    except Exception:
        pyfalog.exception("Failed to load user target profiles")
        return []


def _default_target_spec(fit):
    tp = fit.targetProfile
    if tp is not None:
        return {"type": "profile", "id": tp.ID}
    return {"type": "profile", "id": 0}


def _default_target(ctx, fit):
    """The target used when a target-dependent graph got none: the fit's own
    target profile, else the ideal target (the desktop's default first target)."""
    TargetWrapper = ctx["TargetWrapper"]
    normal = ctx["GraphLightness"].normal
    solid = ctx["GraphLineStyle"].solid
    tp = fit.targetProfile
    if tp is not None:
        return TargetWrapper(tp, normal, solid)
    return TargetWrapper(ctx["TargetProfile"].getIdeal(), normal, solid)


def _resolve_target(ctx, fit, spec):
    """``None`` | ``"fit:<id>"`` | ``"profile:<id>"`` (0 is the ideal target)."""
    if not spec:
        return None
    kind, _, id_part = spec.partition(":")
    try:
        tgt_id = int(id_part)
    except (TypeError, ValueError):
        raise ValueError("invalid target '{}'".format(spec))
    TargetWrapper = ctx["TargetWrapper"]
    normal = ctx["GraphLightness"].normal
    solid = ctx["GraphLineStyle"].solid
    if kind == "fit":
        from service.fit import Fit
        tgt_fit = Fit.getInstance().getFit(tgt_id)
        if tgt_fit is None:
            raise ValueError("target fit {} not found".format(tgt_id))
        return TargetWrapper(tgt_fit, normal, solid)
    if kind == "profile":
        if tgt_id == 0:
            profile = ctx["TargetProfile"].getIdeal()
        else:
            profile = ctx["TargetProfile"].getBuiltinById(tgt_id)
            if profile is None:
                profile = next((p for p in _user_profiles() if p.ID == tgt_id), None)
        if profile is None:
            raise ValueError("target profile {} not found".format(tgt_id))
        return TargetWrapper(profile, normal, solid)
    raise ValueError("invalid target '{}'".format(spec))


# ---------------------------------------------------------------------------
# Colours, line styles, serialisation
# ---------------------------------------------------------------------------


def _hsl_to_rgb(hsl):
    h, s, v = _ctx["hsl_to_hsv"](hsl)
    return colorsys.hsv_to_rgb(h, s, v)


def _rgb_hex(rgb):
    """0-1 float RGB tuple -> '#rrggbb'."""
    if rgb is None:
        rgb = (0.5, 0.5, 0.5)
    return "#{:02x}{:02x}{:02x}".format(
        max(0, min(255, round(rgb[0] * 255))),
        max(0, min(255, round(rgb[1] * 255))),
        max(0, min(255, round(rgb[2] * 255))))


def _line_type(ctx, style_id):
    GraphLineStyle = ctx["GraphLineStyle"]
    return {
        GraphLineStyle.solid: "solid",
        GraphLineStyle.dashed: "dashed",
        GraphLineStyle.dotted: "dotted",
        GraphLineStyle.dashdotted: "dashdot",
    }.get(style_id, "solid")


def _series_name(src, tgt):
    if tgt is None:
        return src.shortName
    if getattr(tgt, "isProfile", False) and getattr(tgt.item, "builtin", False):
        return "{} vs {}".format(src.shortName, _translate_target_fragment(tgt.shortName))
    return "{} vs {}".format(src.shortName, tgt.shortName)


def _segments_to_series(ctx, view, segments, ammo_style, base_rgb, base_line_type, src, tgt):
    """Turn ammo segments into series the way canvasPanel colours them.

    ``color``  -> one series per ammo, coloured by the ammo table
    ``pattern`` -> one series per segment, base colour, line pattern per ammo
    ``none``    -> one series per segment, base colour, solid
    """
    style_keys = list(ctx["STYLES"].keys())
    get_ammo_color = getattr(view, "getAmmoColor", None)
    series = []
    for seg_index, segment in enumerate(segments):
        xs = segment.get("xs") or []
        ys = segment.get("ys") or []
        if not _valid(xs, ys):
            continue
        ammo = segment.get("ammo", "Unknown")
        ammo_index = segment.get("ammoIndex", 0)
        if ammo_style == "color" and get_ammo_color:
            color = get_ammo_color(ammo) or base_rgb
            line_type = base_line_type
            name = ammo
        elif ammo_style == "pattern":
            color = base_rgb
            line_type = _line_type(ctx, style_keys[ammo_index % len(style_keys)])
            name = _series_name(src, tgt)
        else:
            color = base_rgb
            line_type = "solid"
            name = _series_name(src, tgt)
        series.append({
            "name": name,
            "color": _rgb_hex(color),
            "lineType": line_type,
            "ammo": ammo if ammo_style == "color" else None,
            "points": [[float(v) for v in pair] for pair in zip(xs, ys)],
        })
    return series


def _valid(xs, ys):
    if not xs or not ys or len(xs) != len(ys):
        return False
    return all(math.isfinite(float(x)) and math.isfinite(float(y)) for x, y in zip(xs, ys))


def _spec_json(spec):
    data = {"handle": spec.handle, "unit": spec.unit, "label": spec.selectorLabel or spec.label}
    main_input = getattr(spec, "mainInput", None)
    if main_input is not None:
        data["mainInput"] = list(main_input)
    return data


def _vector_json(vector_def):
    if vector_def is None:
        return None
    return {
        "lengthHandle": vector_def.lengthHandle,
        "lengthUnit": vector_def.lengthUnit,
        "angleHandle": vector_def.angleHandle,
        "angleUnit": vector_def.angleUnit,
        "label": vector_def.label,
    }


def _conditions_json(defn):
    out = []
    for x_cond, y_cond in getattr(defn, "conditions", ()) or ():
        out.append([
            list(x_cond) if x_cond else None,
            list(y_cond) if y_cond else None,
        ])
    return out


def _serialize_view(ctx, view):
    vector_handles = set()
    for vector_def in (view.srcVectorDef, view.tgtVectorDef):
        if vector_def is not None:
            vector_handles.add(vector_def.lengthHandle)
            vector_handles.add(vector_def.angleHandle)
    return {
        "id": view.internalName,
        "name": view.name,
        "hasTargets": view.hasTargets,
        "hasSegments": getattr(view, "hasSegments", False),
        "xDefs": [_spec_json(d) for d in view.xDefs if not d.hidden],
        "yDefs": [_spec_json(d) for d in view.yDefs if not d.hidden],
        "inputs": [
            {
                "handle": i.handle,
                "unit": i.unit,
                "label": i.label,
                "defaultValue": i.defaultValue,
                "defaultRange": list(i.defaultRange) if i.defaultRange else None,
                "conditions": _conditions_json(i),
            }
            for i in view.inputs if i.handle not in vector_handles
        ],
        "checkboxes": [
            {
                "handle": c.handle,
                "label": c.label,
                "defaultValue": c.defaultValue,
                "conditions": _conditions_json(c),
            }
            for c in view.checkboxes
        ],
        "srcVector": _vector_json(view.srcVectorDef),
        "tgtVector": _vector_json(view.tgtVectorDef),
    }



def _conditions_ok(defn, x_spec, y_spec):
    """Same visibility rule as ``ctrlPanel.__checkInputConditions``."""
    if not getattr(defn, "conditions", None):
        return True
    for x_cond, y_cond in defn.conditions:
        x_ok = y_ok = True
        if x_cond is not None:
            x_ok = x_spec.handle == x_cond[0] and x_spec.unit == x_cond[1]
        if y_cond is not None:
            y_ok = y_spec.handle == y_cond[0] and y_spec.unit == y_cond[1]
        if x_ok and y_ok:
            return True
    return False

