"""Read 1914 state owners from a Hearts of Iron IV mod. Nothing here is copied into the repo.

The Great War Redux keeps a 1910 base owner and dated blocks. The owner used here is the
one in force on 28 July 1914, after those blocks and before wartime occupation.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

# Outbreak of the war. Later dated blocks are occupation, not the 1914 sovereign.
CUTOFF = (1914, 7, 28)

DATE_RE = re.compile(r"(\d{4})\.(\d{1,2})\.(\d{1,2})\s*=\s*\{")
OWNER_RE = re.compile(r"\bowner\s*=\s*([A-Za-z0-9_]+)")

# Mod tags to the owner ids already used by the WorldOS 1914 map, plus a few
# polities the mods keep that WorldOS folds into an empire.
TAG_TO_OWNER = {
    "ENG": "united_kingdom",
    "FRA": "france",
    "GER": "german_empire",
    "ITA": "italy",
    "RUS": "russia",
    "SOV": "russia",
    "TUR": "ottoman_empire",
    "OTT": "ottoman_empire",
    "JAP": "empire_of_japan",
    "USA": "united_states",
    "CHI": "china",
    "QIN": "china",
    "SPR": "spain",
    "SPA": "spain",
    "POR": "portugal",
    "BEL": "belgium",
    "HOL": "netherlands",
    "SER": "serbia",
    "BUL": "bulgaria",
    "GRE": "greece",
    "ROM": "romania",
    "SWE": "sweden",
    "NOR": "norway",
    "DEN": "denmark",
    "SWI": "switzerland",
    "ALB": "albania",
    "MNT": "montenegro",
    "MON": "mongolia",
    "TIB": "tibet",
    "PER": "persia",
    "AFG": "afghanistan",
    "EGY": "egypt",
    "LBA": "libya",
    # French protectorate from the Treaty of Fez, 30 March 1912. Not a separate sovereign.
    "MOR": "france",
    # Spanish protectorate in the north, from 1912.
    "MRS": "spain",
    # British protected state from the 1899 agreement.
    "KUW": "united_kingdom",
    "AST": "australia",
    "CAN": "canada",
    "NZL": "new_zealand",
    "SAF": "south_africa",
    "BRA": "brazil",
    "ARG": "argentina",
    "CHL": "chile",
    "MEX": "mexico",
    "PRU": "peru",
    "COL": "colombia",
    "VEN": "venezuela",
    "ECU": "ecuador",
    "BOL": "bolivia",
    "PAR": "paraguay",
    "URG": "uruguay",
    "URU": "uruguay",
    "CUB": "cuba",
    "HAI": "haiti",
    "DOM": "dominican_republic",
    "LIB": "liberia",
    "ETH": "abyssinia",
    "OMA": "oman",
    "NEP": "nepal",
    "BHU": "bhutan",
    "SIA": "rattanakosin_kingdom",
    "INS": "netherlands",
    "RAJ": "united_kingdom",
    "AUS": "austro_hungarian_empire",
    "HUN": "austro_hungarian_empire",
    "KUK": "austro_hungarian_empire",
    "AHU": "austro_hungarian_empire",
    # Annexed in 1908. The mod keeps the Bosnian tag and never dates the annexation.
    "BOS": "austro_hungarian_empire",
    "CRE": "greece",
    "LUX": "luxembourg",
    "PAN": "panama",
    "GUA": "guatemala",
    "ELS": "el_salvador",
    "HON": "honduras",
    "NIC": "nicaragua",
    "COS": "costa_rica",
    "NFL": "newfoundland",
    "SAU": "arabia_nejd",
    "HEJ": "hejaz",
    "YEM": "yemen",
    "JOR": "ottoman_empire",
    "IRQ": "ottoman_empire",
    "SYR": "ottoman_empire",
    "LEB": "ottoman_empire",
    "PAL": "ottoman_empire",
    "GEO": "russia",
    "ARM": "ottoman_empire",
    "AZR": "russia",
    "UKR": "russia",
    "BLR": "russia",
    "LIT": "russia",
    "LAT": "russia",
    "EST": "russia",
    "FIN": "russia",
    "POL": "russia",
    "CZE": "austro_hungarian_empire",
    "SLO": "austro_hungarian_empire",
    "CRO": "austro_hungarian_empire",
    "SLV": "austro_hungarian_empire",
    "WTH": "bulgaria",
    "EPR": "albania",
    "MSC": "oman",
    "ADR": "abyssinia",
    "SEN": "libya",
    "DAR": "darfur",
    "DER": "dervish_state",
    "ASR": "idrisid_asir",
    "JBS": "jabal_shammar",
    "NEJ": "arabia_nejd",
    "OIM": "oman_imamate",
    "KOR": "empire_of_japan",
    "MAN": "china",
    "TAN": "china",
    "XSM": "china",
    "SIK": "china",
    "GXC": "china",
    "YUN": "china",
    "SHX": "china",
    "PRC": "china",
    "FER": "russia",
    "TRK": "russia",
    "BUK": "russia",
    "KHI": "russia",
    "TMS": "russia",
    "ALT": "russia",
    "KAZ": "russia",
    "UZB": "russia",
    "TAJ": "russia",
    "KYR": "russia",
    "TKM": "russia",
    "ICE": "denmark",
    "GLD": "denmark",
    "IRE": "united_kingdom",
    "SCO": "united_kingdom",
    "WLS": "united_kingdom",
    "CAT": "spain",
    "BAS": "spain",
    "BRI": "france",
    "OCC": "france",
    "COR": "france",
    "SAR": "italy",
    "SIC": "italy",
    "TUS": "italy",
    "VEN": "venezuela",
    "LOM": "italy",
    "TTS": "italy",
    "PAP": "italy",
    "BAY": "german_empire",
    "SAX": "german_empire",
    "WUR": "german_empire",
    "BAD": "german_empire",
    "PRE": "german_empire",
    "MEK": "german_empire",
    "HAN": "german_empire",
    "OLD": "german_empire",
    "HES": "german_empire",
    "ALS": "german_empire",
    "DNZ": "german_empire",
    "BOH": "austro_hungarian_empire",
    "GLC": "austro_hungarian_empire",
    "TRA": "austro_hungarian_empire",
    "SLI": "united_kingdom",
    "MLT": "united_kingdom",
    "CYP": "united_kingdom",
    "ADE": "united_kingdom",
    "SUD": "united_kingdom",
    "SOM": "united_kingdom",
    "KEN": "united_kingdom",
    "UGA": "united_kingdom",
    "NGA": "united_kingdom",
    "GHA": "united_kingdom",
    "SRL": "united_kingdom",
    "MLY": "united_kingdom",
    "BRM": "united_kingdom",
    "RHD": "united_kingdom",
    "BOT": "united_kingdom",
    "NMB": "german_empire",
    "TZN": "german_empire",
    "CMR": "german_empire",
    "TOG": "german_empire",
    "RWA": "german_empire",
    "BDI": "german_empire",
    "PNG": "german_empire",
    "SAM": "german_empire",
    "FIJ": "united_kingdom",
    "HAW": "united_states",
    "PHI": "united_states",
    "GUM": "united_states",
    "PUE": "united_states",
    "CUBA": "cuba",
    "HND": "honduras",
    "SLV": "el_salvador",
    "CRC": "costa_rica",
    "GTM": "guatemala",
    "NIC": "nicaragua",
    "BOL": "bolivia",
    "PERU": "peru",
    "CHL": "chile",
    "ARG": "argentina",
    "MEX": "mexico",
    "COL": "colombia",
    "ECU": "ecuador",
    "PRY": "paraguay",
    "URY": "uruguay",
    "BRA": "brazil",
    "VEN": "venezuela",
    "QAT": "ottoman_empire",
    "BHR": "united_kingdom",
    "UAE": "united_kingdom",
    "YEM": "ottoman_empire",
    "OMA": "oman",
    "SAU": "arabia_nejd",
    "JOR": "ottoman_empire",
    "LEB": "ottoman_empire",
    "SYR": "ottoman_empire",
    "IRQ": "ottoman_empire",
    "PAL": "ottoman_empire",
    "ISR": "ottoman_empire",
    "JOR": "ottoman_empire",
    "IND": "france",
    "TUN": "france",
    "CER": "chinese_eastern_railway",
    "RWL": "ruwalla",
    # Khuzestan stayed under Persian sovereignty. The local Arabistan sheikh was not a separate state.
    "ARB": "persia",
    "AFA": "afar",
    # British protectorate. Foreign affairs were conducted by Britain.
    "SKK": "united_kingdom",
    "LIE": "liechtenstein",
    # British protectorate since 1888.
    "BRN": "united_kingdom",
    "ZAN": "zanzibar",
    "SMR": "san_marino",
    "NAJ": "najran",
    "HBY": "hobyo",
    "MJT": "majeerteen",
    "AMR": "amarat",
    "TON": "tonga",
    "MAL": "united_kingdom",
    # Unfederated Malay States. British protectorates, not separate sovereigns.
    "KEL": "united_kingdom",
    "JOH": "united_kingdom",
    "PLS": "united_kingdom",
    "TRG": "united_kingdom",
    "KED": "united_kingdom",
    "BID": "baidah",
    "MCO": "monaco",
    # British protectorate since 1887.
    "MLD": "united_kingdom",
}

# Spelling variants only. Each one is the same state, not a neighbour with a similar name.
ALIASES = {
    "hong_kong": "hongkong",
    "beiping": "beijing",
    "peking": "beijing",
    "kaiser_wilhelmsland": "new_guinea",
    "novgorod": "novogrod",
    "vastergotland": "vaster_gotland",
    "luxembourg": "luxemburg",
    "wurttemberg": "wurtemberg",
    "eastern_slovakia": "east_slovakia",
    "bucovina": "bukovina",
    "north_transylvania": "northern_transylvania",
    "ust_urt": "ust_yurt",
    "piemonte": "piedmont",
    "stavropol": "stravropol",
    "northern_dobruja": "north_dobrudja",
    "sivas": "silvas",
    "gibraltar": "gibralter",
    "al_qassim": "al_qasim",
    "najiran": "najran",
    "manica_e_sofala": "manica_and_sofala",
    "rhodesia": "rhodessa",
    "bechuanaland": "bechuana_land",
    "saint_pierre_and_miquelon": "st_pierre_and_miquelon",
    "tennessee": "tennesse",
    "pitcairn_island": "pitcarin_island",
    "falkland_islands": "falkand_islands",
    "krasnoyarsk": "kransoyarsk",
    "gangwon": "gwangwon",
    "south_island": "southern_island",
    "west_azerbaijan": "western_azerbaijan",
    "kostanay": "kustanay",
    # Local name in MapChart, English name in the mod. One file each; checked by hand.
    "warszawa": "warsaw",
    "wolyn": "volyn",
    "cataluna": "catalonia",
    "puglia": "apulia",
    "lombardia": "lombardy",
    "cabo_verde": "cape_verde",
    "aland_islands": "aland",
    "sicilia": "sicily",
    "sardegna": "sardinia",
    "toscana": "tuscany",
    "kyiv": "kiev",
    "wilno": "vilna",
}

# The mod file with this name is a different place. Do not take its owner.
REJECT_NAME_MATCH = {
    "chamdo": "TGWR 752-Chamdo.txt is Loango in French Congo, not Tibetan Chamdo.",
    "golog": "TGWR 754-Golog.txt is Kufra in Libya, not the Amdo plateau.",
    "ordos": "TGWR 746-Ordos.txt is a British coastal enclave with a naval base, not Ordos.",
    "jiuquan": "TGWR 756-Jiuquan.txt is an Ottoman province with a Bulgarian core, not Gansu.",
    "acre": "TGWR 1021-Acre.txt is Ottoman Acre. MapChart Acre is the Brazilian territory.",
}

# The literal mod filename is a different state. Still a name match, to the state this polygon is.
REDIRECTS = {
    # MapChart draws Samoa beside American Samoa. TGWR 726-Samoa.txt is Pago Pago (USA).
    # 798-Western Samoa.txt is the German colony.
    "samoa": "western_samoa",
}


def slug(name: str) -> str:
    text = name.replace("ł", "l").replace("Ł", "L").replace("ø", "o").replace("Ø", "O")
    text = text.replace("đ", "d").replace("Đ", "D").replace("ß", "ss")
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    out = []
    for ch in text.lower():
        out.append(ch if ch.isalnum() else "_")
    folded = "".join(out)
    while "__" in folded:
        folded = folded.replace("__", "_")
    return folded.strip("_")


def owner_on_28_july_1914(text: str) -> str | None:
    """Walk the file. A dated block later than the cutoff does not change the owner."""
    owner = None
    block_date: tuple[int, int, int] | None = None
    block_depth: int | None = None
    depth = 0
    for line in text.splitlines():
        date_match = DATE_RE.search(line)
        if date_match and (block_depth is None or depth <= block_depth):
            block_date = tuple(int(part) for part in date_match.groups())  # type: ignore[assignment]
            block_depth = depth
        owner_match = OWNER_RE.search(line)
        if owner_match and (block_date is None or block_date <= CUTOFF):
            owner = owner_match.group(1).upper()
        depth += line.count("{") - line.count("}")
        if block_depth is not None and depth <= block_depth:
            block_date = None
            block_depth = None
    return owner


def stem_name(path: Path) -> str:
    stem = path.stem
    # "88-Krakow" or "882 - Oman"
    parts = stem.split("-", 1)
    if len(parts) == 2 and parts[0].strip().isdigit():
        return parts[1].strip()
    return stem.strip()


def load_mod_owners(states_dir: Path, source: str) -> dict[str, dict]:
    """Map a normalised state name to its 28 July 1914 owner."""
    found: dict[str, dict] = {}
    if not states_dir.exists():
        return found
    for path in sorted(states_dir.glob("*.txt")):
        text = path.read_text(encoding="utf-8", errors="replace")
        tag = owner_on_28_july_1914(text)
        if not tag:
            continue
        owner = TAG_TO_OWNER.get(tag, tag.lower())
        record = {
            "tag": tag,
            "owner": owner,
            "file": path.name,
            "source": source,
            "mapped": tag in TAG_TO_OWNER,
        }
        for key in {slug(stem_name(path)), slug(path.stem)}:
            # First file wins. TGWR ids are unique; slug collisions keep the lower id.
            found.setdefault(key, record)
    return found


def lookup_mod(name: str, indexes: list[dict[str, dict]]) -> dict | None:
    key = slug(name)
    redirect = REDIRECTS.get(key)
    if redirect:
        candidates = [redirect]
    else:
        candidates = [key]
        alias = ALIASES.get(key)
        if alias and alias not in candidates:
            candidates.append(alias)
    for candidate in candidates:
        for index in indexes:
            hit = index.get(candidate)
            if hit:
                found = dict(hit)
                found["alias"] = candidate != key
                found["redirected"] = bool(redirect)
                return found
    return None
