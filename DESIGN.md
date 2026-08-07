# PetCare — design language

Staff-facing surfaces are **Operate** mode: the user is in a task, not reading
or being persuaded. Scanability, a consistent component vocabulary, density and
familiar affordances outrank expression. Brand lives in precise details.

The client PWA (Phase 1, not yet built) will be a different brief — a client
checking on their dog is closer to Read/Persuade, and should not inherit this
density wholesale.

## Visual world

The direction references **thepuppyplayground.com**: a warm cream ground, a
loud primary red, warm near-black ink rather than a cool grey, and the pairing
of **Work Sans** for UI with **Changa One** as the display voice. Both faces are
self-hosted via `@fontsource`, so the app has no CDN dependency and works
offline as a PWA.

That site is a marketing surface and this is a staff tool, so the world is
adopted but its application is not. Specifically:

- **Changa One is restricted to identity and page titles.** A heavy condensed
  display face on data labels, buttons and table headers would punish people
  reading this for a full shift. Work Sans carries everything else.
- **Full-saturation red is reserved** for primary actions, active navigation and
  the brand mark. It never fills inactive states or large surfaces.
- **Cream is the ground, white is the content surface.** Cards lift off the
  warm background without needing a shadow.

Only the palette and typefaces are referenced. No logo, wordmark, imagery or
copy is taken from that site; the identity here is Cedar Creek's own.

## Tokens

All values live in `apps/web/src/theme.css` under `:root`. Nothing else declares
a raw colour, size or duration.

**Brand** (`--brand`, `--brand-deep`, `--brand-tint`, `--accent`, `--accent-ink`)
is overridden at runtime per tenant from `platform.tenants.theme`, so the
white-label swap is a config change. Everything below derives from tokens and
survives the swap.

**Neutrals** carry two layers: `--surface` for content, `--ground`/`--surface-2`
for the warm cream backdrop, and `--chrome` for the sidebar. They are warm-biased
so the cream reads as a chosen surface rather than an unstyled one.

**Semantic state** (`--good`, `--warn`, `--bad`, `--info`) is separate from brand
and is the only thing allowed to encode meaning by colour.

Because the brand *is* red, danger is deliberately a darker, less saturated red
(`#8E1418`) than the brand (`#E51B24`), so a destructive state never reads as a
primary action. Semantic colour always ships alongside a label or icon — hue is
never the only signal, which also keeps the interface usable for red-green
colour blindness.

**Type** is a fixed rem scale at roughly a 1.15 ratio, `--t-3xs` (9.5px) through
`--t-2xl` (28px). Product UI is viewed at consistent DPI; fluid `clamp()`
headings that shrink in a sidebar look worse, not better. Work Sans carries
headings, labels, data and body; Changa One appears only as `--font-display` on
the wordmark and page titles.

**Motion** is 120–180ms, and conveys state only: hover, selection, meter fill,
overlay entrance. No page-load choreography — staff load into a task and should
not wait to watch it arrive. Everything collapses under
`prefers-reduced-motion`.

## Rules this codebase follows

- **Elevation is declared once.** Cards use a 1px border; overlays use a shadow.
  A border under a wide soft shadow is the ghost card.
- **No colored left rule as state.** State is carried by a tinted surface plus an
  explicit chip (`In`, `Out`, `Med`, `New`). A 4px stripe reads as decoration and
  forces the reader to hold a legend in their head.
- **Icons are drawn.** `components/Icon.tsx` is authored SVG on a 24px grid,
  1.75 stroke, round caps. No unicode glyphs or emoji standing in for an icon
  system.
- **Every interactive element has its full state set** — default, hover, focus,
  active, disabled — and disabled must *look* disabled.
- **Browser surfaces are themed**: selection, caret, accent-color, scrollbars,
  focus ring, underline offset. They ship with defaults belonging to no design
  system.
- **Digits that sit in columns are tabular.** Occupancy, doses, times, money.
- **Loading uses skeletons** shaped like the thing arriving, not a spinner
  dropped in the middle of content.
- **Empty states teach the interface.** "No arrivals today" explains what would
  appear here and where it comes from; it never just says nothing is here.
- **Copy names the action.** Controls say what happens; errors name the problem
  and the recovery. A missed dose is called a missed dose, not an error code.

## Where colour means something

| Signal | Token | Used for |
| --- | --- | --- |
| Brand | `--brand` | Primary actions, current nav, selection, occupancy fill |
| Accent | `--accent` | Staff avatar, sparing highlight — never a state |
| Good | `--good` | Checked in, dose given, vaccines current |
| Warn | `--warn` | Departing today, expiring vaccine, meal not given, near capacity |
| Bad | `--bad` | Missed dose, expired vaccine, mid-stay expiry, destructive |
| Info | `--info` | Arriving today, new client, unverified record |

Medication is deliberately louder than feeding throughout: a missed dose and a
missed meal are not the same failure.

## Provenance

The design pass follows [Impeccable](https://github.com/pbakaus/impeccable)'s
Operate-mode guidance and craft floor. Impeccable's own visual identity (kinpaku
gold, verdigris patina, Alumni Sans) is its brand, not a system to adopt — the
rules were applied, the palette was not.
