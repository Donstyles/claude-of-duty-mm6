# TeX Gyre Pagella

Four woff2 faces subset from the official GUST e-foundry release of **TeX Gyre
Pagella 2.501** (`qpl2_501otf`): regular, italic, bold, bold italic.

## Why this face is bundled at all

Every screenshot in the first two blind review rounds was set in the wrong
typeface, and nobody noticed for three rounds.

`ui.panels.css` asked for `'Palatino Linotype', 'Book Antiqua', Palatino,
Georgia, 'Times New Roman', serif`. **None of those five exists in the capture
environment** — `fc-list` reports 59 faces and the only serifs among them are
DejaVu Serif, FreeSerif, Liberation Serif and Bitstream Charter. So every
capture fell through the entire stack to the generic `serif`, which fontconfig
resolves to DejaVu Serif: a much wider face with a larger x-height and a
*synthesised* oblique rather than a drawn italic.

That matters more here than it would in most interfaces, because roughly half
of this one is set in italic — every option, label, value and caption. The
working face was never being rendered.

It also invalidated part of a review. A blind reviewer reported "~0.15em
tracking on the action list", `Sell` reading as `S e l l`, word space narrower
than letterspace, and counters clotting at small sizes. There is no
`letter-spacing` anywhere near those components. Those were artefacts of a
fallback face we never chose, and fixing them in the stylesheet would have been
hours spent compensating for a font that was never going to ship.

## Why Pagella specifically

Pagella is a Palatino, which is what the stack was asking for and what MM6
itself used. The requirement that decided it over the alternatives was the
italic: a Palatino-class face with a *drawn* calligraphic italic rather than a
sheared roman. Given how much of the interface is italic, a bundled face with a
synthesised oblique would have been worse than the fallback, not better.

## Subsetting

Latin-1 plus the punctuation the interface actually uses: curly quotes, en and
em dashes, the interpunct, `×`, `→`, `◆` and the card suits. About 110 KB for
all four faces, down from 476 KB of OTF.

If you add a glyph the interface needs — a new arrow, a new dingbat — extend
the `UNI` range and re-subset, or it will silently fall back mid-string.

## Licence

GUST Font License (GFL), a LaTeX Project Public License variant. Free to use,
modify and redistribute, including bundled in a product. The full text ships
with the upstream release at <https://www.gust.org.pl/projects/e-foundry/licenses>.

Upstream: <https://www.gust.org.pl/projects/e-foundry/tex-gyre/pagella>
