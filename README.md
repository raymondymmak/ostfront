# Ostfront

**Ostfront** is a turn-based strategy game you play in the browser. You command Germany and Austria-Hungary in the spring and summer of 1915, during the Gorlice–Tarnów breakthrough on the Eastern Front. Each turn is two weeks (a *fortnight*): 2 May, 16 May, 30 May, 13 June, 27 June, and 11 July. The feel is closer to a light war board game like *Call of War*—no real-time clock, you plan at your own pace—with map depth inspired by *Hearts of Iron IV*, but scoped to one campaign on the Eastern Front. You do not need prior wargame experience; if you have played chess, Civilization, or a mobile strategy game, the ideas will feel familiar.

**[Play Ostfront](https://raymondymmak-ostfront.vercel.app)**

### The history in 30 seconds

In early 1915 the Eastern Front had bogged down. Germany and Austria-Hungary concentrated fresh forces near Gorlice and broke through Russian lines in May. Mackensen’s offensive pushed east: Lemberg (today Lviv) was the big prize Russia had taken in 1914. The game starts on **2 May 1915**, with Russian troops still holding Lemberg while your armies gather around Kraków. Your job is to drive the breakthrough—without losing your own base.

---

## How to play

1. **Start.** Pick a difficulty and begin the offensive. The map shows provinces, your formations, and Russian-held ground.
2. **Select a province.** Click the map or pick a formation from the Orders list. The Province panel shows supply, neighbors, and who holds the ground.
3. **Give orders.** Each formation gets **one** order this fortnight. You can draw an arrow on the map, use **Move** / **Attack** on a neighbor, type a short directive, or ask the Chief of Staff for suggestions (see glossary).
4. **Queue and review.** Queued orders appear in the Orders panel. Attack lines can show estimated odds—they are a **forecast**, not a promise (see below).
5. **End turn.** When you are ready, close the fortnight. Russia’s Stavka issues its orders at the same time, from the same starting map. The engine resolves marches and battles together, then updates supply, income, and victory points.
6. **Read the chronicle.** On a wide screen the Chronicle sits in its own panel; on a phone-width layout, open the **Chronicle** tab. It tells you what happened: battles, retreats, supply cuts, and the grade so far.

### The four orders

| Order | What it does |
| --- | --- |
| **Move** | March into a **friendly** neighboring province you already control. |
| **Attack** | Strike a **neighboring enemy** province. There is no separate “invade” command—**entering enemy ground is always an attack.** |
| **Fortify** | Dig in where you have troops. Costs industry and keeps the garrison busy this fortnight. Entrenchments **finish next fortnight** and raise fort level (up to 3). |
| **Recruit** | Raise a new formation at a **yard**—a depot or your own city with good supply. Payment comes from income at the end of the fortnight; the unit arrives when the turn closes (heavy artillery takes two fortnights). |

A formation in a province with **supply below 30** cannot move or attack. One formation, one order.

### Your goal

Push east and take the Russian objectives **Lemberg**, **Lublin**, and **Rovno**, while **never losing Kraków**—your only home city. Hold all three objectives together and you can end the offensive early. Detailed scoring and schedules are in **[docs/RULES.md](./docs/RULES.md#victory)**.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Province** | One region on the map. Ownership (`owner`) is who held it in 1914; **controller** is who holds it now. |
| **Formation / corps** | A fighting counter on the map (infantry corps, cavalry, heavy artillery). Large corps names on the map may stand for several historical units. |
| **Supply** | How well a province is fed from depots and rails. Low supply weakens attacks and can block movement. |
| **Depot** | A rail hub that anchors supply for one side (e.g. Kraków for you, Warsaw and Rovno for Russia). |
| **Rail** | Links between provinces; friendly-controlled rails help trace supply. Shown on the map legend. |
| **Fort level** | 0–3 entrenchments. Each level makes the province harder to storm. New digging pays off **next** fortnight. |
| **Morale** | Unit fighting spirit; it rises and falls with combat and refit. |
| **Victory points (VP)** | Eastern objectives are worth points only while you hold them (Lemberg 4, Lublin 2, Rovno 3). |
| **Stavka** | Russian high command—**played by the computer** with fixed rules. It does not see your orders when it plans. |
| **Falkenhayn / Chief of Staff** | Optional advisor (General Erich von Falkenhayn). He reads the map and may suggest orders; **Accept** only queues them. He never changes the game by himself. |
| **Chronicle** | The story of each fortnight after the engine resolves it—the source of truth for results. |
| **Central Powers** | Germany and Austria-Hungary—the side you play. |
| **Fortnight** | One game turn = two weeks of campaign time. |

---

## Key ideas that win games

- **Hit one province from several sides.** Two or more of your provinces attacking the same target in the same fortnight fight **one battle** and combine strength, with a bonus multiplier (1.12 / 1.22 / 1.30 by number of directions). You need healthy supply on the attacking provinces for that bonus to apply.
- **Encirclement.** When **two or more** prongs attack and the defender has **no friendly neighbor left at the start of the turn**, the defender suffers extra losses and cannot retreat. Surrounding alone from one direction is not enough—the converging attack matters.
- **Keep troops in supply.** Trace rails back to your depots. Starved provinces cannot march; weak supply dulls attacks. Taking an enemy depot this fortnight may not help battles already locked in—it helps **next** time.
- **Odds are a forecast.** You and Russia both submit orders from the **same** opening map. The defender might march away, dig, or meet you in the field. The numbers on an attack line assume the garrison stays put; the **chronicle** shows what really happened.

More mechanics (turn order, combat, economy, Stavka difficulty) are in **[docs/RULES.md](./docs/RULES.md)**.

---

## Documentation

| Document | Contents |
| --- | --- |
| **[docs/RULES.md](./docs/RULES.md)** | Full rules: turn resolution, combat, economy, victory, Stavka, May 1915 setup. |
| **[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)** | Run locally, scripts, environment variables, APIs, map build, project layout. |
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Codemap for maintainers: HTTP flows, storage, trust boundaries. |
| **[FEATURES.md](./FEATURES.md)** | QA-facing behaviour and test selectors. |

---

## Map data

Province shapes and adjacency come from [MapChart.net](https://mapchart.net) (**[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**), based on map data from **Hearts of Iron IV** by Paradox Interactive. There is no real-world satellite basemap—only the game theater.
