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

import colorsys
import gzip
import json
import os
import statistics
import subprocess
import unicodedata
from collections import Counter
from pathlib import Path

from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

from mod_owners import REJECT_NAME_MATCH, load_mod_owners, lookup_mod, slug as mod_slug
from world_projection import make_projector, region_of

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
TGWR_STATES = Path(os.environ.get("TGWR_STATES", "/tmp/tgwr/history/states"))
TGW_STATES = Path(os.environ.get("TGW_STATES", "/tmp/tgw/mod/thegreatwar/history/states"))

# Frozen on the Europe-only snap so the opening camera does not jump when the
# world sheet is added. Pseudo-degrees, not geographic.
EASTERN_BBOX = [-2.1286, -2.548, 2.6801, 2.405]
EASTERN_VIEW = [-3.0286, -3.248, 3.5801, 3.105]

SNAP_INTERVAL = 0.25
SCALE = 0.05
ORIGIN_X = 780.0
ORIGIN_Y = 480.0
CREDIT = (
    "Map geometry: MapChart.net (CC BY-SA 4.0), based on Hearts of Iron IV "
    "by Paradox Interactive."
)

# June 1915 Eastern Front. Every other MapChart state is drawn the same way,
# with playable set to false. To bring one into the game later, add its
# MapChart id here and a ProvinceDef in lib/data/definitions.ts (name, units,
# supply, controller). The polygon, owner_1914, and neighbors are already in
# the built topology. Then run `npm run build:theater`. The game only moves
# between ids in this set.
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

# De jure sovereign on 28 July 1914, after the name match. Occupation does not
# change the owner. A protectorate is painted as the protecting power unless
# the polity was actually sovereign (Egypt, Albania, Nepal, Bhutan, Oman).
DE_JURE_OVERRIDES = {
    "Bosnia": (
        "austro_hungarian_empire",
        "Annexed in 1908. The mod keeps a Bosnian tag and never dates the annexation.",
    ),
    "Thrace": (
        "bulgaria",
        "MapChart Thrace is Western Thrace (about 25.4E, 42.0N), west of Edirne. The Treaty of Bucharest, 10 August 1913, left it to Bulgaria. Greece received southern Macedonia, including Kavala.",
    ),
    "Nicaragua": (
        "nicaragua",
        "The United States occupied Nicaragua from 1912. It did not annex it.",
    ),
    "Casablanca": (
        "france",
        "French protectorate from the Treaty of Fez, 30 March 1912.",
    ),
    "Labrador": (
        "newfoundland",
        "Labrador belonged to the Dominion of Newfoundland, not Canada.",
    ),
    "Johor": ("united_kingdom", "British protectorate, one of the Unfederated Malay States."),
    "Kelantan": ("united_kingdom", "British protectorate, transferred from Siam in 1909."),
    "Brunei": ("united_kingdom", "British protectorate since 1888."),
    "Kuwait": ("united_kingdom", "British protected state under the 1899 agreement."),
    "Sikkim": ("united_kingdom", "British protectorate. Foreign affairs were conducted by Britain."),
    "Khuzestan": (
        "persia",
        "Persian sovereignty. The Arabistan sheikh was not a separate state.",
    ),
    "Maldives": ("united_kingdom", "British protectorate since 1887."),
}

# Name did not match a mod file, and the area vote is on the wrong side of a border.
FALLBACK_JUDGMENTS = {
    "Troms": ("norway", "Norwegian county. The sample landed in Sweden."),
    "Nordland": ("norway", "Norwegian county. The Swedish border split the vote."),
    "Dutch_Southern_New_Guinea": (
        "netherlands",
        "The MapChart name is the Dutch half of New Guinea. The vote mixed it with German New Guinea.",
    ),
    "Northern_Epirus": (
        "albania",
        "Under Albanian sovereignty by the May 1914 Protocol of Corfu. The vote's plurality was Serbia.",
    ),
    "Sungkiang": (
        "china",
        "The state sits on the Chinese bank of the Ussuri, beside Vladivostok. The vote spilled into Russia.",
    ),
    "Antwerpen": (
        "belgium",
        "Antwerp was Belgian. The vote spilled across the Dutch border.",
    ),
    "Atacama": (
        "chile",
        "Chilean Atacama, south of Antofagasta. The vote split with Argentina along the Andes.",
    ),
    "East_Timor": (
        "portugal",
        "Portuguese Timor. The sample landed on Dutch West Timor.",
    ),
    "Portuguese_Guinea": (
        "portugal",
        "Portuguese Guinea (Guinea-Bissau). The sample spilled into French Guinea.",
    ),
    "Equatorial_Guinea": (
        "spain",
        "Spanish Guinea (Rio Muni and Fernando Po). The sample spilled into Gabon.",
    ),
    "Gilbert_Islands": (
        "united_kingdom",
        "British protectorate from 1892. The sample hit the German Marshalls. Those islands are a separate state.",
    ),
    "Leeward_Islands": (
        "united_kingdom",
        "The British Leeward Islands colony. The sample hit the Danish Virgin Islands.",
    ),
    "North_Darfur": (
        "darfur",
        "The Darfur sultanate, independent until 1916. The sample spilled east into Anglo-Egyptian Sudan.",
    ),
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
    deep = len(rows) <= 300
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
            if not deep:
                continue
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
    holes = []
    if deep:
        union = unary_union(geoms)
        for part in polygon_parts(union):
            for ring in part.interiors:
                holes.append(Polygon(ring).area)
        union_area = round(union.area, 2)
    else:
        union_area = None
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
        "unionAreaPx2": union_area,
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


def run_mapshaper_topo(src: Path, dest: Path):
    """Shared-arc TopoJSON. Quantization is finer than the 0.25 px snap.

    Country borders are the shared edges whose owners differ, cut from the
    same arcs as the state polygons. No simplification.
    """
    cmd = [
        str(MAPSHAPER),
        str(src),
        "-rename-layers",
        "states",
        "-innerlines",
        "where=A.owner_1914!=B.owner_1914",
        "+",
        "name=countryBorders",
        "-o",
        "target=states,countryBorders",
        str(dest),
        "format=topojson",
        "quantization=1000000",
    ]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-1200:] or result.stdout[-1200:])


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


def owner_label(owner: str) -> str:
    if owner in OWNER_LABEL:
        return OWNER_LABEL[owner]
    return owner.replace("_", " ").title()


def muted_color(owner: str) -> str:
    """Neutral grey stored beside the geometry. The client paints from the same rule."""
    hue_hash = 2166136261
    for ch in owner:
        hue_hash ^= ord(ch)
        hue_hash = (hue_hash * 16777619) & 0xFFFFFFFF
    lightness = 0.60 + (hue_hash % 18) / 100
    hue = 36 if ((hue_hash >> 8) % 2) == 0 else 210
    saturation = 0.015 + ((hue_hash >> 16) % 16) / 1000
    red, green, blue = colorsys.hls_to_rgb(hue / 360, lightness, saturation)
    return f"#{int(red * 255):02x}{int(green * 255):02x}{int(blue * 255):02x}"


def from_deg(lon, lat):
    return (lon / SCALE + ORIGIN_X, lat / SCALE + ORIGIN_Y)


def largest_polygon(geom):
    if geom.is_empty:
        return None
    if geom.geom_type == "Polygon":
        return geom
    if geom.geom_type == "MultiPolygon":
        return max(geom.geoms, key=lambda part: part.area)
    if geom.geom_type == "GeometryCollection":
        pieces = [
            part
            for part in geom.geoms
            if part.geom_type in ("Polygon", "MultiPolygon") and not part.is_empty
        ]
        if not pieces:
            return None
        return largest_polygon(max(pieces, key=lambda part: part.area))
    return None


def backdrop_label_points(geom, frame):
    """A label on the land inside the Eastern Front frame, plus the largest far part.

    The piece that merely intersects the frame can be a whole empire. Label the
    clipped piece, which is where main put the country name.
    """
    parts = polygon_parts(geom)
    if not parts:
        return []
    largest = max(parts, key=lambda part: part.area)
    points = []
    visible = []
    for part in parts:
        if not part.intersects(frame):
            continue
        clipped = part.intersection(frame)
        if clipped.is_empty or clipped.area < 1:
            continue
        visible.append(clipped)
    if visible:
        piece = largest_polygon(max(visible, key=lambda item: item.area))
        if piece is not None:
            points.append(piece.representative_point())
    far = largest.representative_point()
    if not points or far.distance(points[0]) > 80:
        points.append(far)
    return points


def main():
    source = HOI4_DIR / "hoi4-states.geojson"
    if not source.exists():
        raise SystemExit(f"Missing {source}. Set HOI4_DIR to the MapChart extract.")
    if not WORLDOS_REGIONS.exists():
        raise SystemExit(f"Missing {WORLDOS_REGIONS}. Set WORLDOS_REGIONS to the 1914 owner map.")
    if not TGWR_STATES.exists():
        raise SystemExit(
            f"Missing {TGWR_STATES}. Point TGWR_STATES at The Great War Redux history/states. "
            "Mod files are read locally and are not written into the repo."
        )
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
    print("AFTER_SNAP", json.dumps({k: after[k] for k in ("features", "overlapsAbove001", "maxOverlapPx2", "sumAreaPx2")}))

    area_before = {props["id"]: geom.area for props, geom in original}
    area_after = {props["id"]: geom.area for props, geom in snapped}
    worst = []
    for name, area in area_before.items():
        if name not in area_after or area <= 0:
            continue
        worst.append((abs(area_after[name] - area) / area, name, area_after[name] - area))
    worst.sort(reverse=True)
    print("WORST_AREA", [(round(item[0], 4), item[1], round(item[2], 3)) for item in worst[:8]])

    pixel_to_europe, coeffs, europe_residuals = fit_geo(snapped)
    points = {}
    for props, geom in snapped:
        rep = geom.representative_point()
        points[props["id"]] = (rep.x, rep.y)
    pixel_to_lonlat, fit_residuals, fit_summary = make_projector(points, pixel_to_europe)
    print("FIT", json.dumps(fit_summary))

    # The Great War (Wolferos) filenames often name a different state than the file
    # contains, so they are not used as a name index. TGWR_STATES is the source.
    indexes = [load_mod_owners(TGWR_STATES, "tgwr")]
    rejected_names = []

    owner_geoms, owner_ids, owner_tree = load_owners()
    votes = {}
    for props, geom in snapped:
        counts = Counter()
        missed = 0
        region_counts = Counter()
        for point in sample_points(geom, step=0.9, cap=64):
            region_counts[region_of(point.x, point.y)] += 1
            lon, lat = pixel_to_lonlat(point.x, point.y)
            owner = owner_at(owner_tree, owner_geoms, owner_ids, lon, lat)
            if owner is None:
                missed += 1
            else:
                counts[owner] += 1
        total = sum(counts.values())
        nearest = None
        if not counts:
            rep = geom.representative_point()
            lon, lat = pixel_to_lonlat(rep.x, rep.y)
            point = Point(lon, lat)
            for index in owner_tree.query(point.buffer(4)):
                dist = owner_geoms[index].distance(point)
                if nearest is None or dist < nearest[0]:
                    nearest = (dist, owner_ids[index])
            if nearest and nearest[0] <= 4:
                counts[nearest[1]] += 1
                total = 1
        winner, win_n = counts.most_common(1)[0] if counts else ("unclaimed", 0)
        votes[props["id"]] = {
            "owner": winner,
            "pct": round(100 * win_n / total, 1) if total else 0,
            "samples": total,
            "missed": missed,
            "region": region_counts.most_common(1)[0][0] if region_counts else None,
            "nearestDeg": None if nearest is None else round(nearest[0], 2),
        }

    name_matched = 0
    fallback = 0
    redirected = 0
    judgments = []
    disagreements = []
    fallback_states = []
    unsure = []
    state_owners = {}
    for props, geom in snapped:
        state_id = props["id"]
        area = votes[state_id]
        reject_reason = REJECT_NAME_MATCH.get(mod_slug(state_id))
        mod = None if reject_reason else lookup_mod(state_id, indexes)
        if reject_reason:
            rejected_names.append({"id": state_id, "reason": reject_reason, "worldosOwner": area["owner"], "worldosPct": area["pct"]})
        if mod:
            name_matched += 1
            final = mod["owner"]
            method = "name"
            if mod.get("redirected"):
                redirected += 1
            if (
                area["owner"] not in (final, "unclaimed")
                and area["samples"] >= 4
                and area["pct"] >= 50
            ):
                disagreements.append(
                    {
                        "id": state_id,
                        "modTag": mod["tag"],
                        "modOwner": mod["owner"],
                        "modFile": mod["file"],
                        "modSource": mod["source"],
                        "worldosOwner": area["owner"],
                        "worldosPct": area["pct"],
                        "finalOwner": final,
                        "redirected": bool(mod.get("redirected")),
                        "alias": bool(mod.get("alias")),
                    }
                )
        else:
            fallback += 1
            final = area["owner"]
            method = "fallback"
            fallback_states.append(
                {
                    "id": state_id,
                    "owner": final,
                    "pct": area["pct"],
                    "region": area["region"],
                }
            )
            judged = FALLBACK_JUDGMENTS.get(state_id)
            if judged:
                judgments.append(
                    {
                        "id": state_id,
                        "vote": final,
                        "votePct": area["pct"],
                        "owner": judged[0],
                        "reason": judged[1],
                    }
                )
                final = judged[0]
                fallback_states[-1]["owner"] = final
                fallback_states[-1]["judged"] = True
            if not judged and (final == "unclaimed" or area["pct"] < 60 or area["samples"] < 3):
                unsure.append(
                    {
                        "id": state_id,
                        "owner": final,
                        "pct": area["pct"],
                        "samples": area["samples"],
                        "region": area["region"],
                        "nearestDeg": area["nearestDeg"],
                    }
                )
        state_owners[state_id] = final
        area["method"] = method
        area["final"] = final

    override_report = []
    for state_id, forced in OWNER_OVERRIDES.items():
        info = votes[state_id]
        override_report.append(
            {
                "id": state_id,
                "owner": forced,
                "resolvedOwner": info["final"],
                "method": info["method"],
                "worldosOwner": info["owner"],
                "worldosPct": info["pct"],
            }
        )
        info["final"] = forced
        state_owners[state_id] = forced
    de_jure_report = []
    for state_id, (forced, reason) in DE_JURE_OVERRIDES.items():
        if state_id not in votes:
            raise SystemExit(f"De jure override names a missing state: {state_id}")
        info = votes[state_id]
        de_jure_report.append(
            {
                "id": state_id,
                "owner": forced,
                "resolvedOwner": info["final"],
                "method": info["method"],
                "reason": reason,
            }
        )
        info["final"] = forced
        state_owners[state_id] = forced
    owner_sources = {state_id: votes[state_id]["method"] for state_id in state_owners}
    for state_id in FALLBACK_JUDGMENTS:
        if state_id in owner_sources:
            owner_sources[state_id] = "override"
    for state_id in OWNER_OVERRIDES:
        if state_id in owner_sources:
            owner_sources[state_id] = "override"
    for state_id in DE_JURE_OVERRIDES:
        if state_id in owner_sources:
            owner_sources[state_id] = "override"
    # Refresh a disagreement row if an override changed the owner that will be stored.
    for row in disagreements:
        row["finalOwner"] = state_owners[row["id"]]
    print(
        "OWNERS",
        json.dumps(
            {
                "nameMatched": name_matched,
                "fallback": fallback,
                "redirected": redirected,
                "rejectedNames": len(rejected_names),
                "judgments": len(judgments),
                "disagreements": len(disagreements),
                "unsure": len(unsure),
            }
        ),
    )

    # One feature per MapChart state. Backdrop states use this same snapped
    # geometry: no dissolve, no extra simplify, no buffer.
    states = []
    used_slugs: dict[str, str] = {}
    for props, geom in snapped:
        state_id = props["id"]
        base = slug(state_id)
        key = base
        suffix = 2
        while key in used_slugs:
            key = f"{base}_{suffix}"
            suffix += 1
        used_slugs[key] = state_id
        if geom.is_empty or geom.area <= 0:
            raise SystemExit(f"State {state_id} has no area after the snap")
        states.append(
            {
                "id": key,
                "stateId": state_id,
                "name": props.get("name") or state_id.replace("_", " "),
                "owner": state_owners[state_id],
                "playable": state_id in PLAYABLE,
                "source": owner_sources.get(state_id, "fallback"),
                "geom": geom,
            }
        )
    playable_states = [item for item in states if item["playable"]]
    if len(playable_states) != len(PLAYABLE):
        raise SystemExit(f"Expected {len(PLAYABLE)} playable states, got {len(playable_states)}")
    if len(states) != len(snapped):
        raise SystemExit(f"Expected {len(snapped)} states, got {len(states)}")

    slugs = [item["id"] for item in states]
    geoms = [item["geom"] for item in states]
    tree = STRtree(geoms)
    neighbors = {key: [] for key in slugs}
    overlap_left = []
    for i, geom in enumerate(geoms):
        for j in tree.query(geom.buffer(0.05)):
            j = int(j)
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
    print("ADJACENT_PAIRS", sum(len(value) for value in neighbors.values()) // 2, "OVERLAPS", overlap_left[:8])

    playable_ids = {item["id"] for item in playable_states}
    seen = set()
    stack = [playable_states[0]["id"]]
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        stack.extend(other for other in neighbors[node] if other in playable_ids)
    isolated = sorted(playable_ids - seen)
    print("DISCONNECTED", isolated)

    city_hits = {}
    for name, (lon, lat) in CITIES.items():
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
            best = None
            for props, geom in snapped:
                dist = geom.distance(point)
                if best is None or dist < best[0]:
                    best = (dist, props["id"])
            city_hits[name] = {
                "state": None if best is None or best[0] > 4 else best[1],
                "distancePx": None if best is None else round(best[0], 2),
                "inside": False,
            }
        else:
            city_hits[name] = {"state": hit, "slug": slug(hit), "inside": True, "playable": hit in PLAYABLE}

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
    print("RAILS_DROPPED", json.dumps(dropped_rails))

    centroids = {}
    for item in states:
        point = label_point(item["geom"])
        centroids[item["id"]] = list(to_deg(point.x, point.y))

    vx0, vy0 = from_deg(EASTERN_VIEW[0], EASTERN_VIEW[1])
    vx1, vy1 = from_deg(EASTERN_VIEW[2], EASTERN_VIEW[3])
    frame = box(min(vx0, vx1), min(vy0, vy1), max(vx0, vx1), max(vy0, vy1))

    # Country names only. Dissolving here is for the label point, not the fill.
    by_owner: dict[str, list] = {}
    for item in states:
        if item["playable"]:
            continue
        by_owner.setdefault(item["owner"], []).append(item["geom"])
    country_labels = []
    for owner, parts in by_owner.items():
        geom = unary_union(parts)
        if not geom.is_valid:
            geom = geom.buffer(0)
        spots = backdrop_label_points(geom, frame)
        if not spots:
            continue
        country_labels.append(
            {
                "owner": owner,
                "name": owner_label(owner),
                "label": list(to_deg(spots[0].x, spots[0].y)),
                "labels": [list(to_deg(point.x, point.y)) for point in spots],
            }
        )
    country_labels.sort(key=lambda item: item["owner"])

    features = []
    for item in states:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": item["id"],
                    "stateId": item["stateId"],
                    "name": item["name"],
                    "owner_1914": item["owner"],
                    "playable": item["playable"],
                    "source": item["source"],
                },
                "geometry": transform_geom(item["geom"]),
            }
        )
    states_path = work / "states-deg.geojson"
    states_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    topo_path = work / "states.topojson"
    run_mapshaper_topo(states_path, topo_path)
    topology = json.loads(topo_path.read_text())
    objects = topology.get("objects") or {}
    if "states" not in objects or "countryBorders" not in objects:
        raise SystemExit(f"TopoJSON layers missing: {sorted(objects)}")
    state_geoms = objects["states"].get("geometries") or []
    if len(state_geoms) != len(states):
        raise SystemExit(f"TopoJSON kept {len(state_geoms)} states, expected {len(states)}")
    tiny_ids = ("Hong_Kong", "Macau", "Gibraltar", "Singapore", "Luxembourg", "Malta", "Bahrain", "Danzig")
    by_state_id = {item["stateId"]: item for item in states}
    for state_id in tiny_ids:
        item = by_state_id[state_id]
        print(f"TINY {item['id']} area_px2={item['geom'].area:.4f} playable={item['playable']}")

    minx = min(geom.bounds[0] for _props, geom in snapped)
    miny = min(geom.bounds[1] for _props, geom in snapped)
    maxx = max(geom.bounds[2] for _props, geom in snapped)
    maxy = max(geom.bounds[3] for _props, geom in snapped)
    pad = 12.0
    world_px = (minx - pad, miny - pad, maxx + pad, maxy + pad)
    world_bbox = [round(v, 4) for v in (*to_deg(world_px[0], world_px[1]), *to_deg(world_px[2], world_px[3]))]
    sea = {
        "type": "Polygon",
        "coordinates": [
            [
                list(to_deg(world_px[0], world_px[1])),
                list(to_deg(world_px[2], world_px[1])),
                list(to_deg(world_px[2], world_px[3])),
                list(to_deg(world_px[0], world_px[3])),
                list(to_deg(world_px[0], world_px[1])),
            ]
        ],
    }

    owners_used = sorted({item["owner"] for item in states})
    owner_colors = {owner: muted_color(owner) for owner in owners_used}
    audit = {
        "states": len(snapped),
        "nameMatched": name_matched,
        "fallback": fallback,
        "nameRedirected": redirected,
        "rejectedNames": rejected_names,
        "judgments": judgments,
        "deJure": de_jure_report,
        "disagreements": disagreements,
        "fallbackStates": fallback_states,
        "unsure": unsure,
        "fit": fit_summary,
        "sources": {
            "names": "The Great War Redux history/states, public mirror Xaelor/the-great-war-redux. Wolferos Great War filenames do not match the states in those files, so they were not used.",
            "cutoff": "1914-07-28",
            "fallback": "Per-region pixel fit sampled against WorldOS owner_1914",
            "note": "Mod files are not part of this repo.",
        },
    }
    payload = {
        "source": CREDIT,
        "projection": {
            "type": "hoi4-pixel",
            "scale": SCALE,
            "origin": [ORIGIN_X, ORIGIN_Y],
            "note": "lon=(x-780)*0.05, lat=(y-480)*0.05. Display is flat pixel space. The regional fit is only for 1914 owner sampling.",
        },
        "snap": {
            "intervalPx": SNAP_INTERVAL,
            "cleanGapWidthPx": SNAP_INTERVAL,
            "quantization": 1000000,
            "before": before,
            "after": after,
            "maxRelativeAreaChange": round(worst[0][0], 4) if worst else None,
        },
        "ownerOverrides": override_report,
        "ownerAudit": audit,
        "stateOwners": state_owners,
        "ownerColors": owner_colors,
        "bbox": EASTERN_BBOX,
        "viewBbox": EASTERN_VIEW,
        "worldBbox": world_bbox,
        "topology": topology,
        "centroids": centroids,
        "neighbors": neighbors,
        "countryLabels": country_labels,
        "sea": sea,
        "rivers": [],
        "landPolygons": [],
        "seaPolygons": [sea["coordinates"][0]],
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text(raw)
    gzipped = len(gzip.compress(raw.encode("utf-8"), compresslevel=9))
    print(
        f"WROTE {OUT_PATH} bytes={OUT_PATH.stat().st_size} gzip={gzipped} "
        f"states={len(states)} playable={len(playable_states)} labels={len(country_labels)}"
    )
    report = {
        "fit": fit_summary,
        "fitResiduals": fit_residuals,
        "europeResiduals": europe_residuals,
        "nameMatched": name_matched,
        "fallback": fallback,
        "redirected": redirected,
        "disagreements": disagreements,
        "unsure": unsure,
        "fallbackStates": fallback_states,
        "overrides": override_report,
        "railsDropped": dropped_rails,
        "railsKept": kept_rails,
        "disconnected": isolated,
        "cities": city_hits,
        "worldBbox": world_bbox,
    }
    (work / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print("REPORT", work / "report.json")


if __name__ == "__main__":
    main()
