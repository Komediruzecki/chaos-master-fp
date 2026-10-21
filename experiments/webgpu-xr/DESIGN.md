---
name: Night Almanac
description: A star atlas printed in bone and rubric, with two musical world inks.
colors:
  primary: '#ECE7DC'
  secondary: '#E0644A'
  background: '#08090C'
  surface: '#0E1014'
  muted: '#B9B4AA'
  hover: '#FFFAF0'
  alert: '#F3B3A2'
  glasswake: '#E0C489'
  tideweave: '#74B8A4'
---

# Design System: Night Almanac

## Overview

**Creative North Star: "Night Almanac, two inks"**

The interface is a star atlas printed on black paper. Bone carries readable
content. Rubric marks navigation and notation. Gold belongs to Glasswake and
verdigris belongs to Tideweave. The real fractal and book lead; the surrounding
controls use precise, opaque surfaces and a clear action hierarchy.

This direction replaces the previous brass and cyan shell. It follows the
owner-requested redesign consultation and preserves the existing interactions.

## Colors

Bone is the primary text and filled action ink. Rubric marks the selected page,
staff lines and atlas numerals. World inks identify musical forms and earned
progress. Other chrome stays neutral.

The ink surface ramp is `#0E1014`, `#161920`, `#20242C`. Secondary text is
`#B9B4AA`; captions use `#8E8A82` on opaque dark surfaces. Decorative rules use
`#2A2F38`, control outlines `#5E646E`. Alerts use `#F3B3A2` on `#2A1612`.
Filled actions brighten to `#FFFAF0` on hover.
Contrast must be verified against the actual rendered background.

## Typography

Newsreader roman and italic carry titles and musical modes. IBM Plex Sans
carries controls and body copy. Noto Music supplies the clef and accidentals.
All fonts are locally hosted, with their OFL licenses and source receipts.

Display titles use 34–56px Newsreader; section headings use 28–36px. Modes
use 18px italic Newsreader. Body copy uses 15px Plex with 1.55 line height;
controls use 14px medium Plex and captions use 13px. No visible text is smaller
than 13px; small labels use sans, never a tiny serif.

## Layout

Desktop interfaces have a 64px header and 16–48px fluid gutters. The Almanac
places its book beside a 360–420px listening column. The motif is the first
action in that column. Under 900px, the same content stacks beneath the book;
compact screens shorten the stage to keep playback reachable in the first view.
The seven-page strip stays attached to the book.

## Elevation & Depth

Dark scrims support copy over the live scene. Dialogs and side panels are opaque.
Shadows are reserved for lifted surfaces: `0 8px 24px rgb(0 0 0 / .35)` and
`0 24px 80px rgb(0 0 0 / .6)`. Materials and lighting supply the book's depth;
the interface does not simulate parchment, glow or glass panels.

## Shapes

Controls have 2px corners; dialogs have 4px corners. Selected navigation uses
a rubric edge and neutral raised surface. Every enabled control is at least
44px in both dimensions. Glyphs mirror the physical page details: three stars
and a four-gem melody path.

## Components

**Buttons:** at most one bone-filled primary per visible state. Secondary
actions have a strong outline; tertiary actions are text. Focus is a bone
outline with a dark separation halo. Motion is limited to short color and
surface transitions and is removed for reduced-motion preference.

**World tabs:** the world seal uses its own ink. Selected state uses rubric;
earned state is explicit text and a mark, not color alone.

**Staff:** five rubric rules, diatonic spacing, ledger lines, real note stems,
and note names. A ring and world ink identify the playing note.

**Dialogs:** native modal semantics, focus restoration and escape behavior.
Page sections are separated by a rule, with earned glyphs above the facts.

## Do's and Don'ts

- Do keep music, material objects and earned progress visible before secondary
  explanations or debug tools.
- Do keep error, protected-save and temporary-save states readable.
- Do preserve accessible names, keyboard control and reduced motion.
- Don't use world colors for unrelated chrome.
- Don't present previews as playable worlds or desktop proof as Quest proof.
- Don't add texture claims until the runtime actually supplies those textures.
