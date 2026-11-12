# Studying the World Map
[![Latest release](https://img.shields.io/github/v/release/jackindisguise/studying-the-world-map)](https://github.com/jackindisguise/studying-the-world-map/releases/latest)

An Anki deck for learning to recognise every country on a map and a few facts about each. This project holds everything needed to generate the deck's data and images.

## The deck
- **Countries:** 197 in total: the 193 UN members plus Vatican City, Palestine, Taiwan and Kosovo (`data/countries.json`).
- **Notes:** one *Country Map* note per country, keyed by its ISO 3166-1 alpha-3 code (Kosovo is `XKX`).
- **Cards:** two per note. *Locate* shows a map with the country highlighted and asks which country it is. *Flag to Country* shows the flag and asks for the country.
- **Back of the card:** name, flag, region, capital, bordering countries, languages, currency, government, religion, population, GDP, GDP per capita, land area, density, happiness score, leader, party, head of state and the date the data was gathered. Empty rows are hidden.
- **Sub-decks:** one per region (North America, South America, Europe, Africa, Central America, Caribbean, Asia, Oceania).
- **Maps:** one SVG per country, a north-up Mercator view at a fixed ground scale, with the country in red and its neighbours in grey. Very small places get a dot and a zoom inset so they stay visible.

## What this project does
- **Collects the data:** pulls facts from Wikidata, the World Bank, Wikipedia and the World Happiness Report, merges them with hand-written overrides, and writes one record per country to `data/records.json`. Each numeric value (population, GDP, GDP per capita, land area, density, happiness) carries its rank among the countries that have a value, as `43,844,111 (#36/197)`; 1 is the highest and ties share a rank.
- **Draws the maps:** renders every country's map SVG from Natural Earth shapes (`build/media/`).
- **Fetches the flags:** downloads the original flag SVGs from Wikimedia Commons (`data/flags-svg/`).
- **Writes the note file:** a single Anki-importable CSV, `build/notes.csv`, with one row per country, most populous first (`npm run notes`). It has import headers (note type, deck and tags columns); the Map and Flag fields are `<img>` tags that point at the files in `build/media/`, named `map-<ISO>.svg` and `flag-<ISO>.svg`. Import that folder's files into Anki's media folder as they are.
- **Makes example images:** `npm run examples` renders card screenshots into `docs/images/` for the AnkiWeb page (`docs/ankiweb.md`). It needs Edge or Chrome and a rendered `build/media`.
- **Keeps the card design:** stores the Anki card templates and CSS in `templates/`.

It does not talk to Anki; getting the records, maps and flags into the deck is done separately.

## Layout
- `scripts/` data pipeline and map renderer (run everything from the package root).
- `data/` committed inputs: country list, cached Wikidata/Wikipedia/World Bank/Natural Earth/happiness sources (`data/raw`), flags (`flags-svg`) and the derived JSON (`facts-all`, `leaders`, `religion`, `records`).
- `templates/` the Anki card templates, saved from the *Country Map* note type: one folder per card (`locate`, `flag-to-country`) with `front.html`, `back.html` and `style.css`.
- `build/` generated output: `build/media/map-<ISO>.svg`, `build/fit/boxes.json`.

## Dependencies
Requires Node.js 22.12 or newer (developed on Node 26). Install with `npm install`.

npm packages:
- `d3-geo`: map projections and geometry (area, bounds, distance, point-in-polygon).
- `topojson-client` and `topojson-server`: build the country topology that gives land borders (shared arcs) and merged continent outlines.
- `world-atlas`: 50m country shapes, used as the fast backdrop on every map.
- `anki-apkg-export`: writes the `.apkg` package (custom note type, decks, tags and media).
- `@resvg/resvg-js`: rasterizes outlines internally for the label-placement masks. No images are written with it.

Data sources (already cached in `data/`, only fetched again by the refresh and fetch scripts, which need internet access):
- Natural Earth 10m admin-0 countries (public domain): the country shapes, in `data/raw/natural-earth/`.
- Wikidata (SPARQL): country list, capitals, flags, languages, currency, government, parties.
- World Bank API: population, GDP, GDP per capita, land area, density.
- Wikipedia: the current heads of state and government list, and Pew 2020 religion figures.
- Our World in Data export of the World Happiness Report: happiness score.
- Wikimedia Commons: the original flag SVGs.

## Usage
### Install
```
npm install
```

### Build
```
npm run build
```
Generates image files for maps (`map-XYZ.svg`) and flags (`flag-XYZ.svg`), and the `notes.csv` file.

### Anki Deck
```
npm run apkg
```
Bundles `build/notes.csv`, the images in `build/media/` and the card templates into `build/studying-the-world-map-<version>.apkg`, ready to import into Anki, then adds the deck descriptions.

### Anki Deck
```
npm run apkg:build
```
Builds the `build/studying-the-world-map-<version>.apkg` file without adding descriptions.

### Anki Deck Descriptions
```
npm run apkg:describe
```
Fills in each deck's description (from `data/deck-descriptions.json`) in an existing package, in place. The descriptions are Markdown, and the script turns on each deck's Markdown option. It's a separate step so you can test it without rebuilding the deck: `node scripts/add-deck-descriptions.js in.apkg out.apkg` writes to a different file.

### Render
Render a few maps or all at once.
```
node scripts/render-all.js BLZ FJI
node scripts/render-all.js
```

### Refreshing data
```
npm run refresh-data
```

Re-fetches Wikidata/World Bank facts, re-parses `data/raw/wikipedia/heads.json`, then rebuilds leaders, religion and records.
To get a fresh Wikipedia heads list, re-download it into `data/raw/wikipedia/heads.json` first.
Hand overrides live in `scripts/leaders.js`.

## Releases
Releases are automated with [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`):

1. Commit to `main` with [conventional commit](https://www.conventionalcommits.org) titles (`feat:`, `fix:`, `docs:` and so on).
2. release-please keeps a release pull request open that bumps the version in `package.json` and updates `CHANGELOG.md`.
3. Merging that pull request creates the GitHub release and the `v<version>` tag. The workflow then runs `npm run build` and `npm run apkg` and attaches `studying-the-world-map-<version>.apkg` to the release.