"""Per-region fit from HOI4 pixel space to real lon/lat.

The sheet stays flat. This mapping is only for sampling the 1914 owner map
when a state's name does not match a mod file. Europe keeps the quadratic
already used for the Eastern Front. Other sheets get their own affine fit.
"""

from __future__ import annotations

import math

# state id, longitude, latitude. Compact states, or a state's representative point
# near the namesake city. Used only to fit the fallback sampler.
ANCHORS = {
    "europe": [
        ("Danzig", 18.65, 54.35),
        ("Klaipeda", 21.14, 55.71),
        ("Katowice", 19.02, 50.26),
        ("Tešínsko", 18.63, 49.75),
        ("Warszawa", 21.01, 52.23),
        ("Poznan", 16.93, 52.41),
        ("Königsberg", 20.51, 54.71),
        ("Kaunas", 23.90, 54.90),
        ("Wilno", 25.28, 54.69),
        ("Lodz", 19.46, 51.76),
        ("Kielce", 20.63, 50.87),
        ("Płock", 19.71, 52.55),
        ("Białystok", 23.17, 53.13),
        ("Rīga", 24.11, 56.95),
        ("Lublin", 22.57, 51.25),
        ("Kyiv", 30.52, 50.45),
        ("Odessa", 30.72, 46.48),
        ("Minsk", 27.56, 53.90),
        ("Kraków", 19.95, 50.06),
        ("Lwów", 24.03, 49.84),
        ("Gdynia", 18.53, 54.52),
        ("Madrid", -3.70, 40.42),
        ("Istanbul", 28.98, 41.01),
        ("Lisbon", -9.14, 38.72),
        ("Greater_London_Area", -0.12, 51.51),
        ("Iceland", -19.02, 64.96),
        ("Murmansk", 33.08, 68.97),
        ("Omsk", 73.37, 54.99),
    ],
    "north_america": [
        ("New_York", -75.5, 43.0),
        ("Texas", -99.3, 31.3),
        ("Florida", -81.7, 27.8),
        ("California", -119.4, 37.2),
        ("Washington", -120.5, 47.4),
        ("Colorado", -105.5, 39.0),
        ("Minnesota", -94.6, 46.3),
        ("Georgia_US", -83.4, 32.7),
        ("Mexico_City", -99.13, 19.43),
        ("Cuba", -79.5, 21.7),
        ("Guatemala", -90.5, 15.5),
        ("Jamaica", -77.3, 18.1),
        ("Haiti", -72.3, 19.0),
        ("Newfoundland", -55.8, 48.6),
        ("Alaska", -152.0, 64.0),
    ],
    "south_america": [
        ("Lima", -76.5, -11.5),
        ("Rio_de_Janeiro", -43.2, -22.9),
        ("Buenos_Aires", -60.0, -36.0),
        ("Santiago", -71.0, -35.0),
        ("La_Paz", -67.0, -16.5),
        ("Montevideo", -56.2, -34.4),
        ("Formosa", -59.5, -25.5),
        ("Falkland_Islands", -59.0, -51.7),
        ("Suriname", -56.0, 4.0),
        ("Trinidad", -61.2, 10.5),
    ],
    "africa": [
        ("Cairo", 31.2, 30.0),
        ("Cape", 22.0, -32.0),
        ("Lagos", 4.0, 8.0),
        ("Algiers", 3.0, 36.7),
        ("Tunisia", 9.5, 34.0),
        ("Tripoli", 13.2, 32.9),
        ("Khartoum", 32.5, 15.6),
        ("Nairobi", 36.8, -1.3),
        ("Casablanca", -7.6, 33.6),
        ("Madagascar", 46.5, -19.5),
        ("Togo", 0.9, 8.0),
    ],
    "middle_east": [
        ("Baghdad", 44.4, 33.3),
        ("Tehran", 51.4, 35.7),
        ("Damascus", 36.3, 33.5),
        ("Cyprus", 33.4, 35.1),
        ("Muscat", 57.5, 22.0),
        ("Province_of_Aden", 46.0, 13.0),
    ],
    "south_asia": [
        ("Delhi", 77.2, 28.7),
        ("Bombay", 73.0, 19.0),
        ("Ceylon", 80.7, 7.6),
        ("Kabul", 69.2, 34.5),
        ("Maldives", 73.5, 3.2),
    ],
    "east_asia": [
        ("Qingdao", 120.4, 36.1),
        ("Taiwan", 121.0, 23.7),
        ("Shanghai", 121.5, 31.2),
        ("Hong_Kong", 114.2, 22.3),
        ("Guangzhou", 113.3, 23.1),
        ("Hokkaido", 142.5, 43.5),
        ("Vladivostok", 132.0, 43.2),
        ("Ulaanbaatar", 106.9, 47.9),
        ("Irkutsk", 104.3, 52.3),
        ("Chukotka", 172.0, 66.0),
    ],
    "southeast_asia": [
        ("Manila", 121.0, 14.6),
        ("Bangkok", 100.5, 13.7),
        ("Singapore", 103.8, 1.35),
        ("Batavia", 106.8, -6.2),
        ("Guam", 144.8, 13.4),
    ],
    "oceania": [
        ("Fiji", 178.0, -17.8),
        ("Auckland", 174.8, -36.8),
        ("Papua", 147.0, -7.0),
        ("New_Caledonia", 165.5, -21.3),
        ("Solomon_Islands", 160.0, -9.0),
        ("Bismarck", 150.0, -5.5),
    ],
    "pacific_left": [
        ("Hawaii", -157.5, 20.5),
        ("Tahiti", -149.4, -17.6),
        ("Samoa", -172.1, -13.8),
        ("American_Samoa", -170.7, -14.3),
        ("Midway_Island", -177.4, 28.2),
        ("Phoenix_Island", -170.7, -3.7),
    ],
    # Drawn in the blank south-east Pacific, not on the South American coast.
    "southeast_pacific": [
        ("Easter_Island", -109.4, -27.1),
        ("Pitcairn_Island", -130.1, -25.1),
    ],
    # One polygon, west of the date line. Longitude uses the same pixel scale as Europe.
    "bering_left": [
        ("Chukchi_Peninsula", -176.0, 66.0),
    ],
}


def region_of(x: float, y: float) -> str:
    """Which sheet a pixel sits on. First match wins."""
    if x < 50 and y > 540:
        return "bering_left"
    if x < 190 and y < 430:
        return "pacific_left"
    # Western Australia sits just left of the other Australian states.
    if x > 1140 and y < 210:
        return "oceania"
    if x > 1180 and y < 290:
        return "oceania"
    if x > 1040 and 175 <= y < 336:
        return "southeast_asia"
    if x > 1020 and y >= 420:
        return "east_asia"
    if x > 1040 and y >= 330:
        return "east_asia"
    if 930 < x <= 1075 and 245 < y < 425:
        return "south_asia"
    if 825 < x <= 980 and 270 < y < 445:
        if y >= 408 and x < 895:
            return "europe"
        return "middle_east"
    if y < 408 and 640 < x < 930:
        return "africa"
    if 200 < x < 420 and y < 200:
        return "southeast_pacific"
    if y < 345 and x < 610:
        return "south_america"
    if x < 560 and y >= 340:
        return "north_america"
    if x < 620 and y >= 425:
        return "north_america"
    return "europe"


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


def fit_affine(samples):
    """lon = a + b x + c y, lat = d + e x + f y."""
    if len(samples) < 3:
        raise RuntimeError(f"need 3 anchors, got {len(samples)}")
    design = [[1.0, x, y] for _name, x, y, _lon, _lat in samples]

    def regress(values):
        normal = [[sum(row[i] * row[j] for row in design) for j in range(3)] for i in range(3)]
        rhs = [sum(row[i] * values[k] for k, row in enumerate(design)) for i in range(3)]
        return solve(normal, rhs)

    lons = [lon for _name, _x, _y, lon, _lat in samples]
    lats = [lat for _name, _x, _y, _lon, lat in samples]
    lon_c = regress(lons)
    lat_c = regress(lats)
    return lon_c, lat_c


def _southeast_pacific(x, y, samples):
    (n1, x1, y1, lon1, lat1), (n2, x2, y2, lon2, lat2) = samples[:2]
    if abs(x2 - x1) < 1e-6:
        lon = lon1
    else:
        lon = lon1 + (lon2 - lon1) * (x - x1) / (x2 - x1)
    if abs(y2 - y1) < 1e-6:
        lat = lat1
    else:
        lat = lat1 + (lat2 - lat1) * (y - y1) / (y2 - y1)
    return wrap_lon(lon), lat


def wrap_lon(lon: float) -> float:
    while lon > 180:
        lon -= 360
    while lon < -180:
        lon += 360
    return lon


def make_projector(points: dict[str, tuple[float, float]], europe_fn):
    """points: state id -> (x, y) representative pixel.

    europe_fn(x, y) -> (lon, lat) is the Eastern Front quadratic.
    """
    fits = {}
    residuals = []
    for region, anchors in ANCHORS.items():
        samples = []
        for name, lon, lat in anchors:
            xy = points.get(name)
            if xy is None:
                residuals.append({"id": name, "region": region, "missing": True})
                continue
            samples.append((name, xy[0], xy[1], lon, lat))
        if region == "bering_left":
            # Same horizontal scale as the European sheet. One anchor cannot fit an affine.
            continue
        if region == "southeast_pacific":
            # Two islands. Longitude tracks x, latitude tracks y.
            fits[region] = ("lon-x", samples)
            for name, x, y, lon, lat in samples:
                pred_lon, pred_lat = _southeast_pacific(x, y, samples)
                residuals.append(
                    {
                        "id": name,
                        "region": region,
                        "lonErr": round(pred_lon - lon, 2),
                        "latErr": round(pred_lat - lat, 2),
                    }
                )
            continue
        if len(samples) < 3:
            raise RuntimeError(f"{region} has {len(samples)} anchors")
        lon_c, lat_c = fit_affine(samples)
        fits[region] = (lon_c, lat_c)
        for name, x, y, lon, lat in samples:
            pred_lon = lon_c[0] + lon_c[1] * x + lon_c[2] * y
            pred_lat = lat_c[0] + lat_c[1] * x + lat_c[2] * y
            residuals.append(
                {
                    "id": name,
                    "region": region,
                    "lonErr": round(pred_lon - lon, 2),
                    "latErr": round(pred_lat - lat, 2),
                }
            )

    def pixel_to_lonlat(x: float, y: float):
        region = region_of(x, y)
        if region == "bering_left":
            # (x - 697) / 3.9 puts the left-edge peninsula near 176°W, which is where it is.
            return (x - 697.0) / 3.9, 66.0
        if region == "southeast_pacific":
            return _southeast_pacific(x, y, fits[region][1])
        if region == "europe":
            # The Eastern Front polynomial is the one the theater was built with.
            # South of that band it returns a nonsense latitude, so use the affine.
            lon, lat = europe_fn(x, y)
            if 42 <= lat <= 68:
                return lon, lat
        lon_c, lat_c = fits[region if region != "europe" else "europe"]
        lon = lon_c[0] + lon_c[1] * x + lon_c[2] * y
        lat = lat_c[0] + lat_c[1] * x + lat_c[2] * y
        return wrap_lon(lon), lat

    by_region = {}
    for item in residuals:
        if item.get("missing"):
            continue
        bucket = by_region.setdefault(item["region"], [])
        bucket.append(math.hypot(item["lonErr"], item["latErr"]))
    summary = {
        region: {
            "anchors": len(errors),
            "rms": round((sum(e * e for e in errors) / len(errors)) ** 0.5, 2),
            "max": round(max(errors), 2),
        }
        for region, errors in by_region.items()
    }
    return pixel_to_lonlat, residuals, summary
