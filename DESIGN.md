# PetCare — design language

Staff-facing surfaces are **Operate** mode: the user is in a task, not reading
or being persuaded. Scanability, a consistent component vocabulary, density and
familiar affordances outrank expression. Brand lives in precise details.

The client PWA (Phase 1, not yet built) will be a different brief — a client
checking on their dog is closer to Read/Persuade, and should not inherit this
density wholesale.

## Tokens

All values live in `apps/web/src/theme.css` under `:root`. Nothing else declares
a raw colour, size or duration.

**Brand** (`--brand`, `--brand-deep`, `--brand-tint`, `--accent`, `--accent-ink`)
is overridden at runtime per tenant from `platform.tenants.theme`, so the
white-label swap is a config change. Everything below derives from tokens and
survives the swap.

**Neutrals** carry two layers: `--surface` for content, `--surface-2`/`--ground`
for chrome (sidebar, toolbars, table hover, modal footers). They are green-biased
rather than pure grey, so they sit under the spruce brand rather than fighting it.

**Semantic state** (`--good`, `--warn`, `--bad`, `--info`) is separate from brand
and is the only thing allowed to encode meaning by colour. The accent is for
primary actions, current selection and state indicators — never decoration.

**Type** is a fixed rem scale at roughly a 1.15 ratio, `--t-2xs` (11px) through
`--t-2xl` (28px). Product UI is viewed at consistent DPI; fluid `clamp()`
headings that shrink in a sidebar look worse, not better. One family throughout —
a well-tuned sans carries headings, labels, data and body. No display face.

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
