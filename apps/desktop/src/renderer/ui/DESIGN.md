# Design System: Quiet Craft

## 1. Product Context & Window Contract

Quiet Craft is the desktop design system for this Electron application. It is not a marketing site, and it does not target mobile browsers.

The main window is created with these constraints:

- **Default window size**: `1100 x 750`
- **Minimum window size**: `900 x 640`
- **Maximum window size**: no enforced `maxWidth` or `maxHeight`
- **Window state**: user-resized bounds may be restored on relaunch
- **Custom title bar overlay**: `36px` high on Windows and Linux when the custom title bar is enabled

Design decisions must therefore work in three realities:

1. **Minimum desktop**: the UI must remain usable at `900 x 640`
2. **Default launch size**: the UI should feel balanced at `1100 x 750`
3. **Expanded desktop**: layouts should scale cleanly on larger windows without assuming fullscreen-only compositions

Responsive behavior in this project means **desktop rebalancing**, not mobile collapse. Do not introduce phone-style navigation, hamburger-only primary navigation, or narrow-web assumptions below `900px`.

---

## 2. Overview & Creative North Star

**Creative North Star: "Quiet Craft"**

The product should feel like a carefully arranged work surface: calm, tactile, editorial, and deliberate. It should communicate competence through proportion, spacing, contrast, and rhythm rather than through dense framing, loud semantic color, or ornamental effects.

Quiet Craft is not minimalism for its own sake. It is **controlled softness**: neutral surfaces, large radii, disciplined typography, restrained depth, and clear interaction states. The interface should feel premium without becoming precious, and practical without becoming industrial.

---

## 3. Core Principles

### 3.1 Structure Should Be Felt First

Hierarchy should come from spacing, alignment, scale, and tonal contrast before it comes from borders or panel multiplication.

### 3.2 Calm Is Functional

Visual quiet improves scanability. Reduce chrome so the active task, status changes, and key decisions are easier to perceive.

### 3.3 Desktop-Native, Not Web-Native

This product lives inside a resizable Electron window. Layouts should behave like productive desktop surfaces, not landing pages and not mobile breakpoints in disguise.

### 3.4 Soft Does Not Mean Ambiguous

Controls must remain unmistakably interactive. Quiet surfaces are acceptable; vague affordances are not.

### 3.5 Premium Through Restraint

Quality comes from spacing, proportion, typographic discipline, and surface control. Avoid decorative flourishes that do not improve comprehension.

---

## 4. Color & Surface System

### 4.1 Palette Philosophy

Quiet Craft is anchored in neutral tones. Most hierarchy should come from surface value, text contrast, and spacing, not from saturated fills.

Use semantic color sparingly and locally:

- status dots
- inline badges
- focused validation messages
- progress or warning accents with a clear meaning

Large semantic panels should be rare. The overall interface should remain tone-led.

### 4.2 Runtime Tokens

These tokens are already defined in `src/renderer/src/index.css` and should be treated as the baseline surface system:

| Token | Light Value | Dark Value | Primary Use |
|-------|-------------|------------|-------------|
| `--background` | `hsl(240 5% 96%)` | `hsl(212 25% 12%)` | app shell and title-bar-adjacent frame |
| `--surface` | `hsl(0 0% 100%)` | `hsl(212 25% 16%)` | standard content surface |
| `--surface-canvas` | `hsl(0 0% 98%)` | `hsl(180 2% 9%)` | route-level page canvas |
| `--surface-low` | `hsl(240 5% 96%)` | `hsl(180 2% 12%)` | muted wells, grouped controls, search fields |
| `--surface-raised` | `hsl(0 0% 93%)` | `hsl(0 0% 18%)` | hover/selection lift, secondary emphasis |
| `--surface-floating` | `hsl(0 0% 100%)` | `hsl(180 2% 15%)` | dialogs, popovers, floating bars |
| `--surface-foreground` | `hsl(240 6% 10%)` | `hsl(0 0% 98%)` | primary text on Quiet Craft surfaces |
| `--border` | `hsl(240 6% 90%)` | `hsl(212 20% 20%)` | subtle structural borders |
| `--ring` | `hsl(240 10% 4%)` | `hsl(0 0% 96%)` | focus indication |

### 4.3 Surface Usage Rules

- Use `bg-surface-canvas` for the route canvas when a screen should read as a single composed page.
- Use `bg-surface` or `bg-surface-floating` for primary working panels.
- Use `bg-surface-low` for fields, segmented controls, search inputs, and muted support areas.
- Use `bg-surface-raised` for active/hover lift, not as the default page background.
- Floating layers should usually combine `bg-surface-floating` with blur or soft shadow only when they truly sit above the page.

### 4.4 Borders and the Refined-Line Rule

The old "no-line rule" is too absolute for this codebase. The current product baseline uses borders, but they must stay quiet.

Allowed border behavior:

- low-contrast borders on inputs, floating panels, and list containers
- border opacity typically in the `40%` to `60%` range when used with Quiet Craft surfaces
- borders as containment, not as decoration

Avoid:

- bright, hard, high-contrast dividers as the default page structure
- grid-like boxed layouts where every region gets a heavy outline
- stacking multiple bordered cards just to simulate hierarchy

---

## 5. Typography

### 5.1 Font Families

Quiet Craft should reflect the fonts already shipped in the renderer:

- **UI Sans**: `Inter`
- **Numeric / Metrics**: `Manrope` via `font-numeric`
- **Mono / Technical**: `JetBrains Mono`

Do not introduce a second display font for normal product UI. This application already gets its character from weight, spacing, and surface treatment.

### 5.2 Typographic Hierarchy

These ranges match the current renderer patterns and should be treated as the baseline:

| Role | Font | Typical Size | Weight | Notes |
|------|------|--------------|--------|-------|
| Page Title | `Inter` | `24px` to `30px` | `600` to `800` | used for route-level titles and major hero copy |
| Section Title | `Inter` or `font-numeric` | `18px` to `24px` | `600` to `700` | use `font-numeric` only when numbers or metric tone matter |
| Body | `Inter` | `14px` to `16px` | `400` to `500` | default reading text |
| Support Text | `Inter` | `12px` to `14px` | `400` to `500` | descriptions, muted helpers, secondary metadata |
| Overline / Section Label | `Inter` | `10px` to `11px` | `600` | uppercase with `0.16em` to `0.22em` tracking |
| Control Label | `Inter` | `14px` | `500` to `600` | buttons, nav labels, primary actions |
| Numeric Emphasis | `Manrope` | `16px` to `24px` | `600` to `800` | counts, IDs, scores, percentages, section anchors |
| Technical Text | `JetBrains Mono` | `12px` to `14px` | `500` | paths, raw values, CLI-like content |

### 5.3 Typography Rules

- Prefer `tracking-tight` or slight negative tracking for large titles only.
- Use uppercase micro-labels sparingly and consistently; they are architectural cues, not decoration.
- Use `font-numeric` for numbers, timestamps, counts, dimensions, and ranking-like metadata.
- Keep long-form body copy out of oversized headline styles.
- Avoid introducing multiple competing text accents in one block.

---

## 6. Shape, Radius & Depth

### 6.1 Radius Tokens

Use the project radius tokens rather than inventing screen-specific values:

| Token | Value | Typical Use |
|-------|-------|-------------|
| `--radius-quiet-sm` | `0.75rem` | badges, chips, small list items |
| `--radius-quiet` | `1rem` | inputs, segmented controls, standard buttons |
| `--radius-quiet-lg` | `1.5rem` | panels, drawers, grouped containers |
| `--radius-quiet-xl` | `2rem` | hero cards, large dialogs, anchor surfaces |
| `--radius-quiet-capsule` | `9999px` | pill actions, profile capsules, floating controls |

Rounded geometry is central to the identity, but it must stay composed. Avoid mixing too many unrelated radii on the same screen.

### 6.2 Shared Quiet Craft Baselines

These reusable class patterns already exist in `src/renderer/src/components/ui/quietCraft.ts`:

- `quietControlRadiusClass`
- `quietPanelRadiusClass`
- `quietHeroRadiusClass`
- `quietCapsuleClass`
- `quietFocusRingClass`
- `quietFieldSurfaceClass`
- `quietPanelSurfaceClass`
- `quietFloatingSurfaceClass`

Use these when they match the screen rather than rebuilding nearly identical surface recipes inline.

### 6.3 Depth Philosophy

Depth should be soft and atmospheric. Most hierarchy should still come from surface tone first.

Preferred depth model:

- **Flat**: app shell and broad route canvases
- **Panel**: soft border plus restrained ambient shadow
- **Field**: low surface contrast plus inset highlight when useful
- **Floating**: stronger shadow, higher contrast separation, optional blur

Avoid:

- heavy dark shadows
- glassmorphism as a decorative theme
- bright glows
- stacking multiple elevated cards inside each other without a structural reason

---

## 7. Layout & Desktop Sizing

### 7.1 Working Size Bands

This project should be designed against desktop size bands, not web/mobile breakpoints:

| Band | Window Width | Guidance |
|------|--------------|----------|
| Minimum Desktop | `900-1039px` | keep one dominant content flow; reduce parallel columns; preserve core actions without horizontal overflow |
| Standard Desktop | `1040-1279px` | primary target for most route composition; two-pane layouts are acceptable when both panes stay readable |
| Expanded Desktop | `1280px+` | increase breathing room or split-pane width, but cap reading measures and avoid empty oceans of whitespace |

### 7.2 Height Constraints

The minimum height is `640px`, so vertical discipline matters.

Required behavior near the minimum height:

- keep the primary page action area visible early in the scroll
- prefer one primary scroll container over stacked nested scroll regions
- keep headers compact
- ensure dialogs and inspectors can scroll internally rather than clipping content below the fold

### 7.3 Layout Rules for a Desktop Electron App

- Do not design for phone layouts.
- Do not add hamburger-only primary navigation for the main app frame.
- Do not depend on `sm`, `md`, or other web breakpoints to "save" a layout that already fails at `900px`.
- Validate routes at the actual minimum window size, not only in a wide devtools viewport.
- When the window grows larger, increase margin, max-width discipline, or pane balance before adding more decorative chrome.

### 7.4 Preferred Reflow Strategy

When space gets tighter inside the `900px+` desktop range:

1. reduce side padding
2. reduce secondary columns
3. wrap tertiary metadata
4. move support controls below the primary task row
5. collapse non-essential detail blocks into the main flow

Avoid reflow strategies that:

- hide critical actions behind extra taps
- convert the desktop shell into a mobile sheet stack
- introduce horizontal scrolling for standard route content

### 7.5 Content Width Discipline

The main window has no hard maximum width, but content should not stretch indefinitely.

- Centered reading surfaces should usually cap themselves with route-level max widths
- wide windows should create calmer margins or better pane proportions, not longer paragraphs
- tables and logs may use wider spans when the content benefits from it

---

## 8. Navigation & Window Chrome

### 8.1 App Frame

The app frame should feel stable and architectural. Persistent navigation should remain visible, quiet, and easy to scan.

Active navigation states should rely on:

- text weight
- tonal emphasis
- a minimal positional cue

Avoid loud highlighted blocks unless a route explicitly needs stronger task-mode emphasis.

### 8.2 Title Bar Integration

The custom title bar is part of the visual system, not an afterthought.

- Windows and Linux may use a `36px` title bar overlay
- the drag region should remain visually calm
- critical controls must not depend on the area reserved for native window buttons
- top-level layouts should visually sit cleanly beneath the title bar instead of fighting it

---

## 9. Surfaces & Containers

### 9.1 Surface Hierarchy

Use as few structural surfaces as possible:

- one route canvas
- one primary work surface when needed
- selective secondary surfaces for filters, dialogs, or grouped data

Avoid card-on-card-on-card nesting.

### 9.2 Primary Panels

Primary panels should feel consolidated and deliberate. They usually use:

- `bg-surface` or `bg-surface-floating`
- quiet border treatment
- `--radius-quiet-lg` or `--radius-quiet-xl`
- restrained shadow only when they visually lift from the canvas

### 9.3 Floating UI

Dialogs, popovers, and floating bars should feel polished but not theatrical.

- use `bg-surface-floating`
- keep borders soft
- use stronger radius and shadow than base panels
- add blur only when the element truly overlays active content

---

## 10. Controls

### 10.1 Buttons

Button hierarchy should be obvious:

- **Primary**: near-black or strong contrast fill, decisive and singular
- **Secondary**: quiet surface-backed action with visible containment
- **Tertiary**: text-led or low-emphasis utility action

Preferred button behavior:

- capsule or soft rounded geometry
- stable text weight
- subtle press/hover states
- visible focus ring

### 10.2 Inputs & Selects

Inputs should feel integrated with Quiet Craft surfaces, not like imported browser widgets.

Baseline expectations:

- `bg-surface-low`
- quiet border
- readable foreground contrast
- comfortable vertical sizing around the current `h-10` to `h-11` baseline for primary fields
- focus state through ring and contrast, not color alone

### 10.3 Segmented and Toggleable Controls

Soft segmented controls are preferred over sharp utility toggles when the interaction remains obvious. Use muted containers with clearer active states instead of noisy chrome.

---

## 11. Lists, Tables & Detail Views

### 11.1 Repetition

Repeated content should feel rhythmic, not mechanical.

- rows may be lightly contained
- repeated items should align cleanly
- metadata should wrap or truncate intentionally
- separators should stay quiet

### 11.2 Tables

Tables are allowed in this desktop app, but they should still follow Quiet Craft tone.

- use compact uppercase micro-labels for headers when helpful
- keep number-heavy columns in `font-numeric` or mono where clarity improves
- prevent horizontal overflow at the minimum window width for standard workflows

### 11.3 Detail Surfaces

Detail and inspector views should usually preserve one dominant scroll model. Do not split a detail experience into multiple nested scroll regions unless the task truly requires it.

When the window is near `900 x 640`:

- keep key metadata visible without duplicating it in multiple shells
- ensure below-the-fold content remains reachable
- trim legacy chrome before adding new layers

---

## 12. Motion & Feedback

### 12.1 Motion Character

Motion should be short, quiet, and useful.

Preferred behaviors:

- opacity fades
- short positional easing
- soft surface elevation changes
- quick focus and selection transitions

Avoid:

- bouncy novelty motion
- large parallax-style shifts
- long staged loading choreography for routine actions

### 12.2 Interaction Feedback

The user should never have to guess whether an element is interactive.

- hover: tonal lift
- pressed: compression or slight darkening
- focus: visible ring or contrast shift
- active: stronger tonal commitment, not a random color jump

---

## 13. Accessibility & Practical Clarity

A quiet interface still needs strong usability.

Required standards:

- readable contrast in both light and dark themes
- focus visibility on all interactive custom surfaces
- comfortable pointer targets for desktop use
- no state communicated by color alone
- labels and metadata that remain identifiable after truncation

If a calmer visual treatment weakens clarity, clarity wins.

---

## 14. Do's and Don'ts

### Do

- design for `900 x 640` first, then verify the default `1100 x 750` balance
- use the existing `--surface-*`, `--radius-quiet-*`, and font tokens before inventing new ones
- keep page structure calm and consolidated
- use `font-numeric` for numbers, IDs, sizes, and timestamps
- let large windows breathe through spacing and max-width discipline
- keep dialogs, drawers, and popovers visually related to the main app frame

### Don't

- write mobile-first layout rules for the main Electron window
- assume fullscreen when placing critical panels
- rely on heavy borders or stacked cards to manufacture hierarchy
- introduce bright decorative gradients or marketing-style hero treatments into normal app routes
- stretch body copy endlessly across wide windows
- hide primary navigation or essential actions behind narrow-screen patterns that never fit the desktop shell

---

## 15. Implementation Checklist

Before calling a Quiet Craft UI task done:

- [ ] The layout was checked at `900 x 640`
- [ ] The layout still feels balanced around `1100 x 750`
- [ ] Larger windows improve space usage without degrading readability
- [ ] Surface choices map cleanly to existing `--surface-*` tokens
- [ ] Radius choices map cleanly to existing `--radius-quiet-*` tokens
- [ ] Focus-visible states remain obvious
- [ ] No mobile-only navigation or collapse pattern was introduced
- [ ] Any floating surface respects the title-bar and window-chrome reality of Electron

---

## 16. System Definition

**Quiet Craft** is a desktop-native design language for composed, usable software. It blends editorial restraint with operational discipline, producing interfaces that feel calm, modern, and confidently made.

The result should feel less like a generic web dashboard and more like a refined desktop work surface: practical, tactile, and unmistakably designed for sustained use.
