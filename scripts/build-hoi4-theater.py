#!/usr/bin/env python3
"""Build the Eastern Front theater from MapChart Hearts of Iron IV states.

Reads the MapChart SVG derivative and the WorldOS 1914 owner map from outside
the repo (HOI4_DIR and WORLDOS_REGIONS). Writes only the cleaned theater
geometry the game ships. The raw SVG and the full state geojson are not
copied into the tree.

Pixel space stays pixel space. Display coordinates are a flat scale of those
pixels into a few pseudo-degrees around the equator so MapLibre can draw them
without a basemap.
"""

from __future__ import annotations

import json
import os
import statistics
import subprocess
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from shapely.geometry import Point, Polygon, mapping, shape
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
HOI4_DIR = Path(os.environ.get("HOI4_DIR", "/cursor/stores/bot/mapchart-hoi4"))
WORLDOS_REGIONS = Path(
    os.environ.get(
        "WORLDOS_REGIONS",
        "/cursor/stores/bot/worldos-map/ww1-1914-regions.geojson",
    )
)
OUT_PATH = ROOT / "lib" / "data" / "theater-geometry.json"
MAPSHAPER = ROOT / "node_modules" / "mapshaper" / "bin" / "mapshaper"

SNAP_INTERVAL = 0.25
SCALE = 0.05
ORIGIN_X = 780.0
ORIGIN_Y = 480.0
CREDIT = (
    "Map geometry: MapChart.net (CC BY-SA 4.0), based on Hearts of Iron IV "
    "by Paradox Interactive."
)

# June 1915 Eastern Front. The other MapChart core states stay as backdrop.
PLAYABLE = {
    "Königsberg",
    "Ermland_Masuren",
    "Danzig",
    "Hinterpommern",
    "Ostmark",
    "Niederschlesien",
    "Oberschlesien",
    "Gdynia",
    "Poznan",
    "Klaipeda",
    "Płock",
    "Warszawa",
    "Lodz",
    "Kielce",
    "Kraków",
    "Katowice",
    "Lublin",
    "Białystok",
    "Lwów",
    "Stanisławów",
    "Wołyn",
    "Polesie",
    "Nowogródek",
    "Wilno",
    "Wilejka",
    "Žemaitija",
    "Kaunas",
    "Sūduva",
    "Aukštaitija",
    "Kurzeme",
    "Zemgale",
    "Minsk",
    "Mozyr",
    "Proskuriv",
    "Bucovina",
    "Eastern_Slovakia",
    "Tešínsko",
    "Podkarpatská_Rus",
    "Czeské_Slezsko",
}

# Compact states whose representative point is close to the namesake city.
ANCHORS = {
    "Danzig": (18.6466, 54.3520),
    "Klaipeda": (21.1443, 55.7060),
    "Katowice": (19.0238, 50.2649),
    "Tešínsko": (18.6333, 49.7494),
    "Warszawa": (21.0122, 52.2297),
    "Poznan": (16.9252, 52.4064),
    "Königsberg": (20.5101, 54.7065),
    "Kaunas": (23.9036, 54.8985),
    "Wilno": (25.2797, 54.6872),
    "Lodz": (19.4560, 51.7592),
    "Kielce": (20.6286, 50.8661),
    "Płock": (19.7064, 52.5463),
    "Białystok": (23.1688, 53.1325),
    "Rīga": (24.1052, 56.9496),
    "Lublin": (22.5684, 51.2465),
    "Kyiv": (30.5234, 50.4501),
    "Odessa": (30.7233, 46.4825),
    "Minsk": (27.5615, 53.9025),
    "Kraków": (19.9450, 50.0647),
    "Lwów": (24.0316, 49.8397),
    "Gdynia": (18.5300, 54.5189),
}

# Area sampling follows the 1936 state shapes. These four are wrong for 1914 and
# are forced on every rebuild: Katowice is German, and Lemberg, Stanislav and
# Bukovina are Austrian. The June 1915 controller (all Central Powers) lives in
# lib/data/definitions.ts and is kept in step with this table.
OWNER_OVERRIDES = {
    "Katowice": "german_empire",
    "Lwów": "austro_hungarian_empire",
    "Stanisławów": "austro_hungarian_empire",
    "Bucovina": "austro_hungarian_empire",
}

OWNER_LABEL = {
    "german_empire": "Germany",
    "austro_hungarian_empire": "Austria-Hungary",
    "russia": "Russia",
    "romania": "Romania",
    "sweden": "Sweden",
    "bulgaria": "Bulgaria",
    "italy": "Italy",
    "denmark": "Denmark",
    "serbia": "Serbia",
    "montenegro": "Montenegro",
    "ottoman_empire": "Ottoman Empire",
    "switzerland": "Switzerland",
    "netherlands": "Netherlands",
    "france": "France",
    "united_kingdom": "United Kingdom",
    "albania": "Albania",
    "greece": "Greece",
    "belgium": "Belgium",
}

# Old scenario cities, used to move units and rails onto the state that contains them.
CITIES = {
    "memel": (21.15, 55.58),
    "shavli": (23.35, 55.85),
    "tilsit": (21.85, 55.05),
    "kovno": (23.9, 54.9),
    "konigsberg": (20.5, 54.71),
    "insterburg": (21.85, 54.55),
    "vilna": (25.28, 54.68),
    "danzig": (18.65, 54.35),
    "allenstein": (20.48, 53.78),
    "suwalki": (22.93, 54.1),
    "grodno": (23.83, 53.68),
    "minsk": (26.35, 53.55),
    "minsk_real": (27.56, 53.90),
    "graudenz": (18.75, 53.48),
    "thorn": (18.6, 53.01),
    "mlawa": (20.38, 53.12),
    "bialystok": (23.16, 53.13),
    "bromberg": (17.97, 53.12),
    "plock": (19.7, 52.55),
    "warsaw": (21.01, 52.23),
    "siedlce": (22.28, 52.17),
    "brest": (23.7, 52.09),
    "pinsk": (26.08, 52.12),
    "posen": (16.93, 52.41),
    "kalisz": (18.08, 51.76),
    "lodz": (19.46, 51.77),
    "radom": (21.15, 51.4),
    "lublin": (22.57, 51.25),
    "kovel": (24.71, 51.21),
    "lutsk": (25.34, 50.75),
    "kielce": (20.63, 50.87),
    "rzeszow": (22.0, 50.04),
    "chelm": (23.5, 51.13),
    "rovno": (26.25, 50.62),
    "krakow": (19.94, 50.06),
    "tarnow": (21.0, 50.01),
    "przemysl": (22.78, 49.78),
    "lemberg": (24.03, 49.84),
    "tarnopol": (25.6, 49.55),
    "stanislav": (24.71, 48.92),
    "kamenets": (26.58, 48.68),
    "czernowitz": (25.94, 48.29),
}

RAIL_PAIRS = [
    ("konigsberg", "insterburg"),
    ("insterburg", "tilsit"),
    ("tilsit", "memel"),
    ("konigsberg", "danzig"),
    ("konigsberg", "allenstein"),
    ("danzig", "graudenz"),
    ("graudenz", "thorn"),
    ("allenstein", "mlawa"),
    ("thorn", "bromberg"),
    ("bromberg", "posen"),
    ("thorn", "plock"),
    ("mlawa", "warsaw"),
    ("plock", "warsaw"),
    ("posen", "kalisz"),
    ("kalisz", "lodz"),
    ("lodz", "warsaw"),
    ("warsaw", "siedlce"),
    ("siedlce", "brest"),
    ("siedlce", "bialystok"),
    ("bialystok", "grodno"),
    ("grodno", "vilna"),
    ("vilna", "kovno"),
    ("kovno", "shavli"),
    ("vilna", "minsk"),
    ("grodno", "minsk"),
    ("brest", "pinsk"),
    ("warsaw", "radom"),
    ("radom", "kielce"),
    ("kielce", "krakow"),
    ("radom", "lublin"),
    ("lublin", "chelm"),
    ("chelm", "kovel"),
    ("krakow", "tarnow"),
    ("tarnow", "rzeszow"),
    ("tarnow", "przemysl"),
    ("rzeszow", "przemysl"),
    ("przemysl", "lemberg"),
    ("lemberg", "tarnopol"),
    ("lemberg", "stanislav"),
    ("tarnopol", "kamenets"),
    ("stanislav", "kamenets"),
    ("kovel", "lutsk"),
    ("lutsk", "rovno"),
    ("rovno", "tarnopol"),
    ("brest", "kovel"),
    ("pinsk", "rovno"),
    ("suwalki", "grodno"),
    ("suwalki", "insterburg"),
]


def slug(name: str) -> str:
    text = name.replace("ł", "l").replace("Ł", "L")
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    out = []
    for ch in text.lower():
        if ch.isalnum():
            out.append(ch)
        else:
            out.append("_")
    folded = "".join(out)
    while "__" in folded:
        folded = folded.replace("__", "_")
    return folded.strip("_")


def load_features(path: Path):
    fc = json.loads(path.read_text())
    rows = []
    for feature in fc["features"]:
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        rows.append((feature["properties"], geom))
    return rows


def polygon_parts(geom):
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type == "MultiPolygon":
        return list(geom.geoms)
    return []


def interior_holes(geom):
    holes = []
    for part in polygon_parts(geom):
        for ring in part.interiors:
            holes.append(Polygon(ring))
    return holes


def topology_stats(rows, near=0.6):
    geoms = [geom for _, geom in rows]
    ids = [props["id"] for props, _ in rows]
    tree = STRtree(geoms)
    pairs = 0
    overlaps = []
    exact_shares = []
    distances = []
    for i, geom in enumerate(geoms):
        for j in tree.query(geom.buffer(near)):
            if j <= i:
                continue
            other = geoms[j]
            if geom.distance(other) > near:
                continue
            pairs += 1
            overlaps.append(geom.intersection(other).area)
            boundary = other.boundary
            near_pts = []
            for part in polygon_parts(geom):
                for coord in part.exterior.coords:
                    point = Point(coord)
                    dist = boundary.distance(point)
                    if dist < 1.2:
                        near_pts.append(dist)
            if len(near_pts) < 3:
                continue
            exact_shares.append(sum(d < 1e-3 for d in near_pts) / len(near_pts))
            distances.extend(near_pts)
    union = unary_union(geoms)
    holes = []
    for part in polygon_parts(union):
        for ring in part.interiors:
            holes.append(Polygon(ring).area)
    tiny = [area for area in holes if area < 0.5]
    return {
        "features": len(rows),
        "neighbourPairs": pairs,
        "medianExactVertexShare": round(statistics.median(exact_shares), 3) if exact_shares else None,
        "sharedBorderSamples": len(exact_shares),
        "overlapsAbove001": sum(area > 0.01 for area in overlaps),
        "maxOverlapPx2": round(max(overlaps), 4) if overlaps else 0,
        "overlapSumPx2": round(sum(overlaps), 3),
        "unionHoles": len(holes),
        "tinyHolesUnder0_5": len(tiny),
        "tinyHoleAreaPx2": round(sum(tiny), 3),
        "holeAreaPx2": round(sum(holes), 3),
        "maxHolePx2": round(max(holes), 3) if holes else 0,
        "vertexMedianPx": round(statistics.median(distances), 4) if distances else None,
        "vertexP90Px": round(sorted(distances)[int(0.9 * len(distances))], 4) if distances else None,
        "sumAreaPx2": round(sum(geom.area for geom in geoms), 2),
        "unionAreaPx2": round(union.area, 2),
    }


def solve(matrix, target):
    size = len(target)
    aug = [row[:] + [target[col]] for col, row in enumerate(matrix)]
    for col in range(size):
        pivot = max(range(col, size), key=lambda row: abs(aug[row][col]))
        aug[col], aug[pivot] = aug[pivot], aug[col]
        if abs(aug[col][col]) < 1e-12:
            raise RuntimeError("singular fit")
        factor = aug[col][col]
        aug[col] = [value / factor for value in aug[col]]
        for row in range(size):
            if row == col:
                continue
            scale = aug[row][col]
            aug[row] = [value - scale * aug[col][index] for index, value in enumerate(aug[row])]
    return [aug[row][-1] for row in range(size)]


def fit_geo(rows):
    by_id = {props["id"]: geom for props, geom in rows}
    samples = []
    for name, (lon, lat) in ANCHORS.items():
        geom = by_id.get(name)
        if geom is None:
            continue
        point = geom.representative_point()
        samples.append((name, point.x, point.y, lon, lat))

    def regress(used):
        design = []
        ys = []
        for _, _x, y, lon, lat in used:
            design.append([1.0, lat, lat * lat, lon])
            ys.append(y)
        coeffs = solve(
            [[sum(row[i] * row[j] for row in design) for j in range(4)] for i in range(4)],
            [sum(row[i] * ys[k] for k, row in enumerate(design)) for i in range(4)],
        )
        return coeffs

    used = samples[:]
    coeffs = regress(used)
    for _ in range(2):
        kept = []
        for sample in used:
            _, _x, y, lon, lat = sample
            pred = coeffs[0] + coeffs[1] * lat + coeffs[2] * lat * lat + coeffs[3] * lon
            if abs(pred - y) <= 6.5:
                kept.append(sample)
        if len(kept) >= 8 and len(kept) != len(used):
            used = kept
            coeffs = regress(used)
        else:
            break

    def pixel_to_lonlat(x, y):
        lon = (x - 697.0) / 3.9
        a, b, c, d = coeffs
        # c*lat^2 + b*lat + (a + d*lon - y) = 0
        disc_b = b
        disc_c = c
        constant = a + d * lon - y
        if abs(disc_c) < 1e-8:
            lat = -constant / disc_b
        else:
            disc = disc_b * disc_b - 4 * disc_c * constant
            disc = max(0.0, disc)
            root_a = (-disc_b + disc**0.5) / (2 * disc_c)
            root_b = (-disc_b - disc**0.5) / (2 * disc_c)
            lat = root_a if 40 <= root_a <= 70 else root_b
        return lon, lat

    residuals = []
    for name, x, y, lon, lat in samples:
        pred_y = coeffs[0] + coeffs[1] * lat + coeffs[2] * lat * lat + coeffs[3] * lon
        pred_x = 3.9 * lon + 697
        residuals.append(
            {
                "id": name,
                "xErr": round(pred_x - x, 2),
                "yErr": round(pred_y - y, 2),
                "kept": any(item[0] == name for item in used),
            }
        )
    return pixel_to_lonlat, coeffs, residuals


def sample_points(geom, step=0.55, cap=220):
    minx, miny, maxx, maxy = geom.bounds
    width = max(maxx - minx, 0.1)
    height = max(maxy - miny, 0.1)
    if (width / step) * (height / step) > cap * 4:
        step = ((width * height) / cap) ** 0.5
    points = []
    y = miny + step * 0.5
    while y < maxy:
        x = minx + step * 0.5
        while x < maxx:
            point = Point(x, y)
            if geom.covers(point):
                points.append(point)
            x += step
        y += step
    rep = geom.representative_point()
    if geom.covers(rep):
        points.append(rep)
    if len(points) > cap:
        stride = len(points) / cap
        points = [points[min(len(points) - 1, int(i * stride))] for i in range(cap)]
    return points


def load_owners():
    fc = json.loads(WORLDOS_REGIONS.read_text())
    geoms = []
    owners = []
    for feature in fc["features"]:
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        geoms.append(geom)
        owners.append(feature["properties"]["owner_1914"])
    return geoms, owners, STRtree(geoms)


def owner_at(tree, geoms, owners, lon, lat):
    point = Point(lon, lat)
    for index in tree.query(point):
        if geoms[index].covers(point):
            return owners[index]
    return None


def run_mapshaper(src: Path, dest: Path, args: list[str]):
    cmd = [str(MAPSHAPER), str(src), *args, "-o", str(dest), "format=geojson", "precision=0.001"]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-800:] or result.stdout[-800:])


def to_deg(x, y):
    return (round((x - ORIGIN_X) * SCALE, 6), round((y - ORIGIN_Y) * SCALE, 6))


def transform_geom(geom):
    def convert(coords):
        if isinstance(coords[0], (float, int)):
            return list(to_deg(coords[0], coords[1]))
        return [convert(item) for item in coords]

    raw = mapping(geom)
    raw["coordinates"] = convert(raw["coordinates"])
    return raw


def label_point(geom):
    target = geom
    if geom.geom_type == "MultiPolygon":
        target = max(geom.geoms, key=lambda part: part.area)
    return target.representative_point()


def shared_length(a, b):
    return a.boundary.intersection(b.boundary).length


def main():
    source = HOI4_DIR / "theater-states.geojson"
    if not source.exists():
        raise SystemExit(f"Missing {source}. Set HOI4_DIR to the MapChart extract.")
    if not WORLDOS_REGIONS.exists():
        raise SystemExit(f"Missing {WORLDOS_REGIONS}. Set WORLDOS_REGIONS to the 1914 owner map.")
    if not MAPSHAPER.exists():
        raise SystemExit(f"Missing {MAPSHAPER}. Install dependencies with npm install.")

    original = load_features(source)
    missing = sorted(name for name in PLAYABLE if name not in {props["id"] for props, _ in original})
    if missing:
        raise SystemExit(f"Playable states missing from the extract: {missing}")
    before = topology_stats(original)
    print("BEFORE", json.dumps(before))

    work = Path("/tmp/hoi4-theater-build")
    work.mkdir(parents=True, exist_ok=True)
    snapped_path = work / "snapped.geojson"
    run_mapshaper(
        source,
        snapped_path,
        [
            "-snap",
            f"interval={SNAP_INTERVAL}",
            "fix-geometry",
            "-clean",
            f"gap-width={SNAP_INTERVAL}",
            "overlap-rule=max-area",
            "-filter-slivers",
            f"gap-width={SNAP_INTERVAL}",
            "keep-shapes",
        ],
    )
    snapped = load_features(snapped_path)
    after = topology_stats(snapped, near=0.4)
    print("AFTER_SNAP", json.dumps(after))

    area_before = {props["id"]: geom.area for props, geom in original}
    area_after = {props["id"]: geom.area for props, geom in snapped}
    worst = []
    for name, area in area_before.items():
        if name not in area_after or area <= 0:
            continue
        worst.append((abs(area_after[name] - area) / area, name, area_after[name] - area))
    worst.sort(reverse=True)
    print("WORST_AREA", [(round(item[0], 4), item[1], round(item[2], 3)) for item in worst[:8]])

    pixel_to_lonlat, coeffs, residuals = fit_geo(snapped)
    print("Y_COEFFS", [round(value, 4) for value in coeffs])
    print("ANCHOR_RESIDUALS", json.dumps(residuals, ensure_ascii=False))

    owner_geoms, owner_ids, owner_tree = load_owners()
    votes = {}
    for props, geom in snapped:
        counts = Counter()
        missed = 0
        for point in sample_points(geom):
            lon, lat = pixel_to_lonlat(point.x, point.y)
            owner = owner_at(owner_tree, owner_geoms, owner_ids, lon, lat)
            if owner is None:
                missed += 1
            else:
                counts[owner] += 1
        total = sum(counts.values())
        if not counts:
            rep = geom.representative_point()
            lon, lat = pixel_to_lonlat(rep.x, rep.y)
            # Coastal slivers often sample as open water. Take the nearest 1914 region.
            point = Point(lon, lat)
            nearest = None
            for index in owner_tree.query(point.buffer(1.2)):
                dist = owner_geoms[index].distance(point)
                if nearest is None or dist < nearest[0]:
                    nearest = (dist, owner_ids[index])
            if nearest and nearest[0] <= 1.2:
                counts[nearest[1]] += 1
                total = 1
        winner, win_n = counts.most_common(1)[0] if counts else ("unknown", 0)
        second = counts.most_common(2)[1] if len(counts) > 1 else None
        votes[props["id"]] = {
            "owner": winner,
            "pct": round(100 * win_n / total, 1) if total else 0,
            "samples": total,
            "missed": missed,
            "second": None if second is None else {"owner": second[0], "pct": round(100 * second[1] / total, 1)},
            "playable": props["id"] in PLAYABLE,
        }

    close = [
        {"id": name, **info}
        for name, info in sorted(votes.items(), key=lambda item: item[1]["pct"])
        if info["pct"] < 80
    ]
    print("OWNERS_UNDER_80", json.dumps(close, ensure_ascii=False))

    override_report = []
    for state_id, forced in OWNER_OVERRIDES.items():
        info = votes[state_id]
        override_report.append(
            {
                "id": state_id,
                "owner": forced,
                "areaOwner": info["owner"],
                "areaPct": info["pct"],
            }
        )
        info["areaOwner"] = info["owner"]
        info["areaPct"] = info["pct"]
        info["owner"] = forced
        info["override"] = True
    print("OWNER_OVERRIDES", json.dumps(override_report, ensure_ascii=False))

    tagged_features = []
    for props, geom in snapped:
        state_id = props["id"]
        owner = votes[state_id]["owner"] or "unknown"
        if state_id in PLAYABLE:
            gid = f"play:{slug(state_id)}"
            name = state_id.replace("_", " ")
            role = "playable"
        else:
            gid = f"bg:{owner}"
            name = OWNER_LABEL.get(owner, owner.replace("_", " ").title())
            role = "backdrop"
        tagged_features.append(
            {
                "type": "Feature",
                "properties": {
                    "gid": gid,
                    "name": name,
                    "role": role,
                    "owner": owner,
                    "slug": slug(state_id) if role == "playable" else gid,
                    "source_id": state_id,
                },
                "geometry": mapping(geom),
            }
        )
    tagged_path = work / "tagged.geojson"
    tagged_path.write_text(json.dumps({"type": "FeatureCollection", "features": tagged_features}))
    dissolved_path = work / "dissolved.geojson"
    run_mapshaper(
        tagged_path,
        dissolved_path,
        ["-dissolve", "gid", "copy-fields=name,role,owner,slug"],
    )
    dissolved = json.loads(dissolved_path.read_text())
    playable_geoms = {}
    backdrop = []
    for feature in dissolved["features"]:
        props = feature["properties"]
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        if props["role"] == "playable":
            playable_geoms[props["slug"]] = (props, geom)
        else:
            backdrop.append((props, geom))

    if len(playable_geoms) != len(PLAYABLE):
        raise SystemExit(f"Expected {len(PLAYABLE)} playable states, got {sorted(playable_geoms)}")

    # Neighbours from shared boundary length. A corner touch is not a border.
    slugs = sorted(playable_geoms)
    geoms = [playable_geoms[key][1] for key in slugs]
    tree = STRtree(geoms)
    neighbors = {key: [] for key in slugs}
    overlap_left = []
    for i, geom in enumerate(geoms):
        for j in tree.query(geom.buffer(0.05)):
            if j <= i:
                continue
            other = geoms[j]
            area = geom.intersection(other).area
            if area > 0.01:
                overlap_left.append((slugs[i], slugs[j], round(area, 4)))
            if shared_length(geom, other) < 0.15:
                continue
            neighbors[slugs[i]].append(slugs[j])
            neighbors[slugs[j]].append(slugs[i])
    for key in neighbors:
        neighbors[key] = sorted(set(neighbors[key]))
    print("PLAYABLE_OVERLAPS", overlap_left)

    # Connectivity of the playable graph.
    seen = set()
    stack = [slugs[0]]
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        stack.extend(neighbors[node])
    isolated = [key for key in slugs if key not in seen]
    print("DISCONNECTED", isolated)

    # Backdrop states fully inside the playable union.
    play_union = unary_union(geoms)
    enclosed = []
    for props, geom in snapped:
        if props["id"] in PLAYABLE:
            continue
        if play_union.covers(geom.representative_point()) and geom.intersection(play_union).area > geom.area * 0.6:
            enclosed.append(props["id"])
    print("ENCLOSED_BACKDROP", enclosed)

    city_hits = {}
    for name, (lon, lat) in CITIES.items():
        # Invert the fitted mapping approximately by scanning state containment
        # in pixel space: project with the x formula and the fitted y.
        y_guess = None
        # Solve y from lon/lat using the same polynomial.
        a, b, c, d = coeffs
        y_guess = a + b * lat + c * lat * lat + d * lon
        x_guess = 3.9 * lon + 697.0
        point = Point(x_guess, y_guess)
        hit = None
        for props, geom in snapped:
            if geom.covers(point):
                hit = props["id"]
                break
        if hit is None:
            # nearest playable or any state within 4 px
            best = None
            for props, geom in snapped:
                dist = geom.distance(point)
                if best is None or dist < best[0]:
                    best = (dist, props["id"])
            hit = None if best is None or best[0] > 4 else best[1]
            city_hits[name] = {"state": hit, "distancePx": None if best is None else round(best[0], 2), "inside": False}
        else:
            city_hits[name] = {"state": hit, "slug": slug(hit), "inside": True, "playable": hit in PLAYABLE}
    print("CITIES", json.dumps(city_hits, ensure_ascii=False))

    def state_of(city):
        info = city_hits.get(city) or {}
        if not info.get("inside"):
            return None
        return slug(info["state"]) if info["state"] in PLAYABLE else None

    kept_rails = []
    dropped_rails = []
    seen_rails = set()
    for a, b in RAIL_PAIRS:
        sa, sb = state_of(a), state_of(b)
        if not sa or not sb or sa == sb:
            dropped_rails.append({"pair": [a, b], "states": [sa, sb], "reason": "same-or-missing"})
            continue
        if sb not in neighbors[sa]:
            dropped_rails.append({"pair": [a, b], "states": [sa, sb], "reason": "no-shared-border"})
            continue
        key = tuple(sorted((sa, sb)))
        if key in seen_rails:
            continue
        seen_rails.add(key)
        kept_rails.append([sa, sb])
    print("RAILS_KEPT", json.dumps(kept_rails))
    print("RAILS_DROPPED", json.dumps(dropped_rails))

    # Frame: the 75 MapChart core states, plus a margin of open water.
    core_geoms = [geom for props, geom in snapped if props.get("theater_role") == "core" or props["id"] in PLAYABLE]
    # snapped features may have lost theater_role. Use the original role via source ids.
    core_ids = {props["id"] for props, _ in original if props.get("theater_role") == "core"}
    core_geoms = [geom for props, geom in snapped if props["id"] in core_ids]
    core_union = unary_union(core_geoms)
    minx, miny, maxx, maxy = core_union.bounds
    pad_n, pad_s, pad_e, pad_w = 8.0, 6.0, 4.0, 4.0
    frame = (minx - pad_w, miny - pad_s, maxx + pad_e, maxy + pad_n)
    bbox = [*to_deg(frame[0], frame[1]), *to_deg(frame[2], frame[3])]
    # maxBounds wider than the fit target so padding can show the whole frame.
    view = (
        frame[0] - 18,
        frame[1] - 14,
        frame[2] + 18,
        frame[3] + 14,
    )
    view_bbox = [*to_deg(view[0], view[1]), *to_deg(view[2], view[3])]

    polygons = {}
    centroids = {}
    for key, (props, geom) in playable_geoms.items():
        polygons[key] = transform_geom(geom)
        point = label_point(geom)
        centroids[key] = list(to_deg(point.x, point.y))

    backdrop_out = []
    for props, geom in backdrop:
        point = label_point(geom)
        backdrop_out.append(
            {
                "id": props["gid"].replace(":", "-"),
                "name": props["name"],
                "owner": props["owner"],
                "label": list(to_deg(point.x, point.y)),
                "geometry": transform_geom(geom),
            }
        )
    backdrop_out.sort(key=lambda item: item["id"])

    sea = {
        "type": "Polygon",
        "coordinates": [
            [
                list(to_deg(view[0], view[1])),
                list(to_deg(view[2], view[1])),
                list(to_deg(view[2], view[3])),
                list(to_deg(view[0], view[3])),
                list(to_deg(view[0], view[1])),
            ]
        ],
    }

    # Post-conversion overlap check in pixel space already done; repeat on degrees roughly via px.
    payload = {
        "source": CREDIT,
        "projection": {
            "type": "hoi4-pixel",
            "scale": SCALE,
            "origin": [ORIGIN_X, ORIGIN_Y],
            "note": "lon=(x-780)*0.05, lat=(y-480)*0.05. Not geographic.",
        },
        "snap": {
            "intervalPx": SNAP_INTERVAL,
            "cleanGapWidthPx": SNAP_INTERVAL,
            "before": before,
            "after": after,
            "maxRelativeAreaChange": round(worst[0][0], 4) if worst else None,
        },
        "ownerOverrides": override_report,
        "bbox": [round(v, 6) for v in bbox],
        "viewBbox": [round(v, 6) for v in view_bbox],
        "polygons": polygons,
        "centroids": centroids,
        "neighbors": neighbors,
        "backdrop": backdrop_out,
        "sea": sea,
        "rivers": [],
        "landPolygons": [],
        "seaPolygons": [sea["coordinates"][0]],
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(f"WROTE {OUT_PATH} bytes={OUT_PATH.stat().st_size} playable={len(polygons)} backdrop={len(backdrop_out)}")

    report = {
        "snapIntervalPx": SNAP_INTERVAL,
        "before": before,
        "after": after,
        "worstArea": [(round(item[0], 4), item[1], round(item[2], 3)) for item in worst[:12]],
        "coeffs": [round(v, 5) for v in coeffs],
        "residuals": residuals,
        "closeCalls": close,
        "owners": votes,
        "cities": city_hits,
        "railsKept": kept_rails,
        "railsDropped": dropped_rails,
        "disconnected": isolated,
        "enclosed": enclosed,
        "neighbors": neighbors,
        "centroids": {key: centroids[key] for key in slugs},
    }
    (work / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print("REPORT", work / "report.json")


if __name__ == "__main__":
    main()
