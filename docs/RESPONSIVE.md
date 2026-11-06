# Phones, tablets and laptops

One layout for each size, decided in a few places so a new screen gets the right behaviour without extra work.

## The breakpoints

| Screen | Width | Navigation | Notes |
| --- | --- | --- | --- |
| Phone | under 768 px | Bottom bar for the main pages, menu button for the rest | Single column. Sticky action bars sit above the bottom bar. |
| Tablet, portrait | 768 to 1023 px | A 64 px icon rail on the left | Content gets about 700 px. Forms and tables use the same single-column layouts as a phone, with more room. |
| Tablet, landscape, small laptop | 1024 to 1279 px | Icon rail | Two-column screens (the inventory entry, for one) start here. |
| Laptop and desktop | 1280 px and up | Full sidebar, 256 px, with names | |

The shell is in `src/components/AppShell.tsx` and the list of pages in `src/lib/nav.ts`. `--bottom-nav-h` (in `globals.css`) is the height of the phone bottom bar, so a sticky bar can sit just above it: `bottom-[var(--bottom-nav-h,0px)]`.

## Touch screens

Anything with a finger as its main pointer (`@media (pointer: coarse)`, which is every phone and tablet) gets, from `globals.css`:

- **Text boxes at 16 px.** Below that, iPad and iPhone Safari zoom the whole page when a box is tapped, and do not zoom back.
- **Controls a finger can hit:** buttons and boxes at least 44 px tall (small buttons 40 px), larger tick boxes.
- A mouse keeps the compact controls.

Screens that have their own phone rules (`.mob`, `.att`) keep them.

## One rule that prevents wide cards

A `grid` with no column template of its own gets a single column that is allowed to shrink (`@layer base` in `globals.css`). Without it the column grows to fit the longest line that cannot wrap, such as a description in a row set to truncate, and the card ends up wider than the screen. This happened on the project page: the Recent expenses card was 1,100 px wide on a 390 px phone. Because the rule is in the base layer, any real template (`grid-cols-2`, `lg:grid-cols-2`) still wins. When writing a grid, giving it a base `grid-cols-1` is still the clearest.

## Checking a screen

1. Run it at 390, 768, 834, 1024 and 1180 px wide, with touch on.
2. Look for: the page scrolling sideways, text or buttons running off the right edge, a button too small to hit, a box that makes the page zoom when tapped.
3. Test with long text: a long vendor name, a long description. Most overflows only show up with real data.

An automated pass is easy to repeat: load each page in a headless browser at those widths and report any element whose right edge is past the screen's.
