# Chess Lab — Navigation Audit
2026-06-02

## Summary
The app actually has **three** distinct navigation patterns, not two. Only **3 of 9 pages** use the full shared analyzer-style drawer with a *visible* opener (`az-topbar` + `az-hamburger` + `#nav-drawer` + `initNav`): **analyzer.html, archive.html, import.html**. Four more pages (**index, profile, recommendations, openings**) carry the `#nav-drawer` markup and call `initNav()`, but their opener is either a hidden legacy `.hamburger-btn` (so the drawer is unreachable) or the old visible `☰` glyph button — they are PARTIAL conformers. **practice.html and index.html** use a completely separate persistent left-rail dashboard nav (`db-sidebar` / `db-nav-item`), and **practice.html has no drawer, no `nav.js`, and no `initNav` at all**. `report.html` is a standalone generated artifact with no nav. Unifying everything is a medium-sized effort dominated by deciding whether the dashboard sidebar (index/practice) should be replaced by the drawer or kept as a parallel pattern.

## The shared standard

`js/nav.js` does **not** build any markup — it only *wires up* drawer markup that must already exist in each page's HTML. There is no template injection; every page hand-copies the drawer.

**`initNav(currentPage)` behavior (js/nav.js:28–82):**
- If no `currentPage` is passed, derives it from the URL filename.
- Looks up `#hamburger-btn` and `#nav-drawer`; **if either is missing it silently returns** (this is why pages can include `nav.js` harmlessly even without a drawer).
- Wires `#hamburger-btn` click → open drawer (adds `.open`, un-hides `#nav-overlay`); wires `#nav-drawer-close` and `#nav-overlay` click → close.
- Highlights the active link by matching `PAGE_HREFS[currentPage]` against each `a.nav-item`'s `href` and toggling `.nav-item-active`.
- Wires coming-soon buttons: `#nav-progress-btn` → toast "Coming soon! 🚀"; `#nav-openings-btn` → navigates to `openings.html`.
- Wires `#change-api-key-link`: on non-analyzer pages, navigates to `index.html` (analyzer handles settings itself).
- Toast helper looks for `#az-toast` / `#hub-toast` / `#import-toast`.

**`PAGE_HREFS` registry (js/nav.js:7–13)** — the only page names `initNav` knows for active-highlighting:
`index, analyzer, archive, practice, import`.
**Not registered:** `openings`, `profile`, `recommendations` — so on those pages `initNav` cannot auto-highlight the active link (they hardcode `nav-item-active` in HTML instead).

**Canonical drawer markup (e.g. analyzer.html:24–50):**
```
#nav-drawer.nav-drawer
  .nav-drawer-header (.nav-drawer-brand "♟ Chess Lab" + #nav-drawer-close)
  nav.nav-drawer-nav
    a.nav-item[href=index.html]            🏠 Home
    a.nav-item[href=analyzer.html]         ♟ Game Analyzer
    a.nav-item[href=archive.html]          📂 Game Archive
    a.nav-item[href=practice.html]         ♜ Practice Board
    a.nav-item[href=recommendations.html]  🎯 My Recommendations
    a.nav-item[href=import.html]           ⬇ Import Games
    button#nav-progress-btn   📈 My Progress  (Soon)
    button#nav-openings-btn   📖 Opening Explorer (Soon)
  .nav-drawer-footer
    button#change-api-key-link  ⚙ Settings / API Key
```
The **visible opener** in the canonical version is the `az-topbar` header with a 3-span `az-hamburger`:
```
header#az-topbar.az-topbar
  .az-topbar-left
    button#hamburger-btn.az-hamburger (3× <span>)
    .az-logo "Chess Lab" + .az-logo-dot
    .az-breadcrumb "Dashboard › <Page>"
  .az-topbar-right (page-specific chips)
```

**Canonical nav entry set (the yardstick):** Home, Game Analyzer, Game Archive, Practice Board, My Recommendations, Import Games, [My Progress – Soon], [Opening Explorer – Soon], + footer Settings/API Key.

## Per-page nav inventory

| Page | Uses shared drawer? | Opener / alternative nav | `initNav` arg | Legacy class refs | Nav entries vs canonical |
|------|--------------------|--------------------------|---------------|-------------------|--------------------------|
| **analyzer.html** | **YES (full)** | `az-topbar` + `az-hamburger` (visible) | `'analyzer'` via **app.js:34** (not inline) | none | ✅ Identical |
| **archive.html** | **YES (full)** | `az-topbar` + `az-hamburger` (visible) | `'archive'` (inline, archive.html:147) | none | ✅ Identical |
| **import.html** | **YES (full)** | `az-topbar` + `az-hamburger` (visible) | `'import'` (inline, import.html:142) | none | ✅ Identical |
| **index.html** | **PARTIAL** | Real nav = persistent **`db-sidebar`** dashboard (index.html:54–126). Drawer present but `#hamburger-btn` is `.hamburger-btn` **hidden** (`display:none`, index.html:46) | `'index'` (inline, index.html:250) | **`.hamburger-btn`** (hidden) | Drawer ≈ canonical **except** `#nav-openings-btn` is **missing its "Soon" badge** (index.html:39–41). Visible db-sidebar has its own entries (see note). |
| **practice.html** | **NO** | Persistent **`db-sidebar`** dashboard nav (`db-sidebar-nav`/`db-nav-item`, practice.html:456–488) + `pb-topbar` (practice.html:505). **No drawer, no nav.js, no `initNav`, no hamburger.** | none | none (uses `db-nav-*` + `pb-*`) | N/A — different nav model & different entries (adds "Study" group, "Tactics – Soon"; labels differ: Dashboard/Openings/Practice) |
| **profile.html** | **PARTIAL** | Drawer present; `#hamburger-btn` is `.hamburger-btn` **hidden** (`display:none`, profile.html:34). Page shows its own `pf-topbar` (profile.html:94) with no drawer opener → **drawer effectively unreachable**. | `'profile'` (inline, profile.html:490) — **not in PAGE_HREFS** | **`.hamburger-btn`** (hidden) | **Differs:** adds `👤 Profile` link (profile.html:30); **missing** My Progress, Opening Explorer buttons **and** the footer Settings link. |
| **recommendations.html** | **PARTIAL** | Drawer present; `#hamburger-btn` **hidden** (`display:none`, recommendations.html:90) and has **no class at all**. Page shows its own `rec-topbar` (recommendations.html:162) with no drawer opener → **drawer effectively unreachable**. | `'recommendations'` (inline, recommendations.html:314) — **not in PAGE_HREFS** | none (bare `#hamburger-btn`, no `.hamburger-btn` class) | ✅ Entries identical to canonical (incl. footer). |
| **openings.html** | **PARTIAL** | Drawer present; opener is the **visible legacy `☰` glyph** `.hamburger-btn` (openings.html:608), sitting inside an `.open-header` (openings.html:607). | `'openings'` (inline, openings.html:862) — **not in PAGE_HREFS** | **`.hamburger-btn`** (visible) + `.open-header` (page-local) | **Differs:** Opening Explorer is rendered as an active `<a>` link (openings.html:592) instead of the `#nav-openings-btn` coming-soon button; otherwise canonical (My Progress – Soon present, footer present). |
| **report.html** (root) | **NO (n/a)** | No nav of any kind — standalone generated analysis report. | none | none | N/A — out of scope |

Notes:
- **index.html is a hybrid**: the *visible* nav is the dashboard `db-sidebar`; the `#nav-drawer` is kept only "for nav.js compatibility" (its own HTML comments, index.html:19–22, 45) and is invisible because the hamburger is `display:none`.
- The db-sidebar (index + practice) is its own family (`db-` prefix). Its CSS header comment (styles.css:4968) claims "index.html only," but **practice.html also uses `db-sidebar-nav` / `db-nav-item`** — the comment is stale.
- `Already Analyzed\1st\report.html` is an archived copy and was ignored.

## Legacy nav code still present

**`.hamburger-btn` (legacy glyph button class):**
- CSS definition — `css/styles.css:2623` (`.hamburger-btn`) and `css/styles.css:2632` (`:hover`). **Still in use.**
- `openings.html:608` — **visible** `.hamburger-btn ☰` (the only place it's still a working visible opener). **In use.**
- `index.html:46` — `.hamburger-btn` but `display:none`. **Dead as UI** (vestigial, kept only so `initNav` finds an element).
- `profile.html:34` — `.hamburger-btn` but `display:none`. **Dead as UI.**
- `recommendations.html:90` — bare `#hamburger-btn`, **no `.hamburger-btn` class**, `display:none`. **Dead as UI** (and doesn't even use the legacy class).

→ The `.hamburger-btn` CSS rule cannot be deleted yet: **openings.html:608 still renders it visibly.** Once openings is migrated, the rule becomes dead (index/profile reference it only on hidden elements).

**Page-specific `*-header` / `*-topbar` used as the page's own top bar (parallel to / instead of the shared nav):**
- `openings.html:607` `.open-header` (+ `.open-header-spacer` 614; CSS at openings.html:26,58) — wraps the legacy hamburger.
- `profile.html:94` `.pf-topbar` — page top bar, no drawer opener.
- `recommendations.html:162` `.rec-topbar` — page top bar, no drawer opener.
- `practice.html:505` `.pb-topbar` — page top bar for the dashboard layout.
- (Not nav, but present: `analyzer.html:178` `.gp-header`, `:265` `.az-card-header`, etc. — content headers, ignore.)
- No `.import-header` / `.archive-header` remain in HTML — both were already migrated to `az-topbar` (confirmed by HANDOFF.md:21,315; only historical mentions remain).

**`initNav(` calls:** app.js:34 (`'analyzer'`), index.html:250, archive.html:147, import.html:142, recommendations.html:314, profile.html:490, openings.html:862. (analyzer is the only one called from JS rather than inline.)

**`#nav-drawer` references:** analyzer.html:24, archive.html:17, import.html:17, index.html:23, profile.html:19, recommendations.html:61, openings.html:576, and nav.js:35. **Not** in practice.html or report.html.

**`az-hamburger` / `az-topbar` references:** analyzer.html:68/70, archive.html:46/48, import.html:46/48; CSS at styles.css:4041 (`.az-topbar`), 4070 (`.az-hamburger`). Only the three full-conformer pages use these.

## CSS classification

**Shared standard (keep — the `az-*` + drawer system):**
- Drawer core: `.nav-drawer` (styles.css:2713), `.nav-drawer.open` (2726), `.nav-drawer-header` (2728), `.nav-drawer-brand` (2738), `.nav-drawer-close` (2744), `.nav-drawer-nav` (2753), `.nav-drawer-footer` (2759), `.nav-item` (2765), `.nav-item:hover` (2783), `.nav-item-active` (2784), `.nav-item-icon` (2789).
- Topbar opener: `.az-topbar` (4041), `.az-topbar-left` (4055), `.az-topbar-right` (4062), `.az-hamburger` (4070), `.az-hamburger span` (4083), `:hover` (4091).

**Legacy (candidate for eventual removal):**
- `.hamburger-btn` (styles.css:2623, 2632) — still needed **only** for openings.html's visible opener. Dead everywhere else.

**Parallel pattern (not "legacy" but not the drawer either):**
- `db-sidebar` family: `.db-nav-item` (styles.css:5117), `.db-nav-item:hover` (5130), and the `DASHBOARD v2 (db-)` block from styles.css:4967. Used by index.html and practice.html. A migration decision is needed on whether this coexists with or is replaced by the drawer.

**Now-dead / removable today:** none can be safely deleted yet — `.hamburger-btn` is still visibly used by openings.html.

## Migration scope assessment

| Page | Effort | Why |
|------|--------|-----|
| **recommendations.html** | **Quick** | Drawer already canonical; just needs a visible opener. Either add `az-topbar` + `az-hamburger` (replace/augment `rec-topbar`) or unhide a proper button. Also add `recommendations` to `PAGE_HREFS` so auto-highlight works (currently hardcoded). |
| **profile.html** | **Quick–Medium** | Needs a visible opener (currently hidden), drawer entry parity (drop the extra `👤 Profile` item or standardize it, add missing My Progress / Opening Explorer / Settings footer), and `profile` added to `PAGE_HREFS`. Convert `pf-topbar` to/alongside `az-topbar`. |
| **openings.html** | **Medium** | Swap the visible legacy `.hamburger-btn` + `.open-header` for `az-topbar` + `az-hamburger`; normalize the Opening Explorer entry (it's an `<a>` here vs the coming-soon button elsewhere); add `openings` to `PAGE_HREFS`. This is also the page that unblocks deleting the `.hamburger-btn` CSS. |
| **index.html** | **Medium (or skip)** | Already calls `initNav('index')` with a (hidden) drawer. Real question is product, not code: do we keep the dashboard `db-sidebar` as index's nav (then the drawer is just redundant and can be removed) or replace the sidebar with the drawer? Also the drawer's Opening Explorer button is missing its "Soon" badge. |
| **practice.html** | **Large** | No drawer, no `nav.js`, no `initNav`, no hamburger — entirely the `db-sidebar` + `pb-topbar` dashboard layout. Migration means adding the full drawer markup, loading `nav.js`, wiring `initNav('practice')`, and reconciling its richer sidebar (Study group, per-item badges like archive count / openings "Drill", connection-status footer, its own `pb-settings-btn`) against the simpler shared drawer. Large file (~1547 lines) with four IIFEs. See Risks. |

## Risks

- **practice.html is the highest-risk migration.** It is a large file (~1547 lines) with **four `<script>` IIFEs** (practice.html:1201, 1249, plus the inline block at 1236 and `js/practice-board.js` at 1245). Its sidebar carries live behavior the shared drawer doesn't: dynamic badges (`#pb-badge-archive` count, `#pb-badge-openings` "Drill"), a connection-status footer (`#pb-status-dot` / `#pb-status-text`), and its own settings button (`#pb-settings-btn`). Dropping in the shared drawer would lose these unless re-homed, and the IIFEs may query `db-nav-*` / `pb-*` IDs that disappear.
- **`PAGE_HREFS` is incomplete.** `openings`, `profile`, `recommendations` are not registered, so `initNav` can't highlight them; they currently fake it with hardcoded `nav-item-active`. Any migration to rely on `initNav` for highlighting must add these keys (nav.js:7–13).
- **Hidden-opener pages look migrated but aren't usable.** profile and recommendations include the drawer + `initNav` but the hamburger is `display:none` with no alternative trigger — the drawer can't actually be opened by a user today. Easy to mistake for "done."
- **Drawer markup is duplicated per page, not templated.** `nav.js` only wires existing markup. Any entry change (e.g., the missing "Soon" badge on index, the `<a>`-vs-button Opening Explorer on openings, the extra Profile link) must be fixed in each HTML file by hand; there's no single source. Consider having `nav.js` inject the drawer to prevent future drift.
- **Stale CSS comment** (styles.css:4968 "db- … index.html only") understates reach — practice.html depends on `db-` too; don't delete `db-` rules assuming index is the only consumer.
- **`.hamburger-btn` removal is gated on openings.html** — deleting the CSS before migrating openings would break its only visible menu button.

## Recommended migration order

1. **recommendations.html** (quick, self-contained; add a visible `az-hamburger`, register in `PAGE_HREFS`). Lowest risk — validates the "add a topbar opener to a drawer-ready page" pattern.
2. **profile.html** (quick–medium; same pattern plus entry-parity cleanup and `PAGE_HREFS` entry).
3. **openings.html** (medium; replaces the *visible* legacy `.hamburger-btn`). Doing this third means that **after it, `.hamburger-btn` CSS is dead** and can be removed in a follow-up.
4. **index.html** (medium / product decision; resolve dashboard-sidebar vs drawer. If sidebar stays, remove the vestigial hidden drawer instead of migrating it).
5. **practice.html** (large; do last, after the pattern is proven on simpler pages, and budget time for the four IIFEs + dynamic sidebar badges/status that the shared drawer doesn't yet support).

After step 3, schedule a cleanup PR to delete the now-dead `.hamburger-btn` rule (styles.css:2623,2632) and reconcile the duplicated drawer markup (ideally move drawer injection into `nav.js`).
