"""Fill missing render files for icon-less items.

Items whose invTypes.iconID is null fall back to their graphicID render
(see web/services/serialize.py item_image). The imgs/renders pack shipped with
the initial extraction omitted many of those renders (drones, fighters, ...), so
their thumbnails 404 in the fitting view and item browser. This downloads the
missing renders from CCP's official image CDN (images.evetech.net), one 32x32
PNG per graphicID (``@1x``) and one 64x64 (``@2x``), matching the existing pack.
"""
import io
import os
import sqlite3
import sys
import time
import urllib.request
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO)

CDN = "https://images.evetech.net/types/{tid}/render?size={size}"

#: Categories to avoid when picking a representative typeID for a graphicID
#: (the render is shared, but blueprints/celestials are not the nicer pick).
AVOID = ("Blueprint", "Celestial", "Commodity", "Accessories")


def existing_renders():
    have = set()
    root = os.path.join(REPO, "imgs", "renders")
    for f in os.listdir(root):
        if f.endswith("@1x.png"):
            have.add(int(f.split("@")[0]))
    return have


def build_manifest():
    con = sqlite3.connect("file:eve.db?mode=ro", uri=True)
    cur = con.cursor()
    rows = cur.execute(
        """
        SELECT t.typeID, t.graphicID, c.name
        FROM invTypes t
        JOIN invGroups g ON g.groupID = t.groupID
        JOIN invCategories c ON c.categoryID = g.categoryID
        WHERE t.published = 1
          AND (t.iconID IS NULL OR t.iconID = 0)
          AND t.graphicID IS NOT NULL AND t.graphicID > 0
        """
    ).fetchall()
    con.close()
    have = existing_renders()
    by_gid = {}
    for type_id, graphic_id, category in rows:
        if graphic_id in have:
            continue
        by_gid.setdefault(graphic_id, []).append((type_id, category))

    def pick(items):
        def rank(item):
            tid, cat = item
            return (cat in AVOID, tid)
        return min(items, key=rank)[0]

    return {gid: pick(items) for gid, items in by_gid.items()}


def download(manifest, dry_run=False):
    ok, fail = [], []
    for gid, tid in sorted(manifest.items()):
        for size, suffix in ((32, "@1x"), (64, "@2x")):
            out = os.path.join("imgs", "renders", f"{gid}{suffix}.png")
            if os.path.exists(out) and os.path.getsize(out) > 0:
                continue
            if dry_run:
                continue
            url = CDN.format(tid=tid, size=size)
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": "pyfa-web-render-backfill/1.0"})
                data = urllib.request.urlopen(req, timeout=25).read()
                im = Image.open(io.BytesIO(data)).convert("RGBA")
                im.save(out, "PNG")
                ok.append((gid, suffix, im.size))
            except Exception as exc:  # noqa: BLE001
                fail.append((gid, tid, size, str(exc)))
            time.sleep(0.03)
    return ok, fail


if __name__ == "__main__":
    from PIL import Image

    manifest = build_manifest()
    print("missing graphicIDs to fill:", len(manifest))
    con = sqlite3.connect("file:eve.db?mode=ro", uri=True)
    cats = Counter(
        c for _, c in con.execute(
            """
            SELECT t.graphicID, c.name
            FROM invTypes t
            JOIN invGroups g ON g.groupID = t.groupID
            JOIN invCategories c ON c.categoryID = g.categoryID
            WHERE t.published = 1
              AND (t.iconID IS NULL OR t.iconID = 0)
              AND t.graphicID IN (%s)
            """ % ",".join("?" * len(manifest)),
            list(manifest),
        ).fetchall()
    )
    con.close()
    print("by category:", dict(cats))
    dry = "--dry-run" in sys.argv
    if dry:
        for gid, tid in sorted(manifest.items())[:20]:
            print("  gid", gid, "-> type", tid)
        sys.exit(0)
    ok, fail = download(manifest)
    print("downloaded+converted:", len(ok))
    print("failures:", len(fail))
    for row in fail[:30]:
        print("  FAIL", row)

