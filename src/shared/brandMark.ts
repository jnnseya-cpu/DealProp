/**
 * The Lode logo, as vector — one definition of the brand artwork.
 *
 * The faceted ore nugget with its gold "lode" vein (the rich seam you are
 * mining for), and the full horizontal lockup with the LODE wordmark. The
 * wordmark is drawn as paths, not set type, so the artwork needs no font and is
 * identical wherever it is rendered.
 *
 * Everything that draws the logo reads it from here: the app header and footer
 * (`Mark` in chrome.tsx), the printed letterhead, and the PWA asset generator.
 * The mark had previously been hand-copied into each of those and the copies
 * drifted — the comment on `Mark` records that exact problem. One source now.
 *
 * The artwork carries its own colours (near-black body, white facet seams, gold
 * vein), so it is never recoloured — on dark surfaces it is placed on a light
 * chip (`LODE_CHIP`) instead, which is what the app header does. The SVG files
 * in `public/brand/` are generated from these strings by `npm run pwa:assets`
 * and must not be hand-edited.
 */

/** The chip the mark sits on over a dark surface, so the black body still reads. */
export const LODE_CHIP = "#f4f1ea";

/** The mark alone: the ore nugget and its gold vein. viewBox 0 0 228 224. */
export const LODE_MARK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 228 224" fill="none" role="img" aria-label="Lode">` +
  `<path d="M92 16 L138 30 L180 64 L210 112 L186 158 L150 196 L104 208 L64 192 L30 150 L18 98 L44 46 Z" fill="#0c0c0e"/>` +
  `<path d="M180 64 L210 112 L186 158 L150 150 L150 96 Z" fill="#1c1c22"/>` +
  `<path d="M92 16 L138 30 L118 70 L80 60 L44 46 Z" fill="#17171c"/>` +
  `<path d="M30 150 L64 192 L104 208 L96 160 L60 150 Z" fill="#050506"/>` +
  `<g stroke="#f4f4f5" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">` +
  `<path d="M44 46 L80 60 L118 70 L138 30"/>` +
  `<path d="M80 60 L96 112"/>` +
  `<path d="M118 70 L150 96 L210 112"/>` +
  `<path d="M150 96 L150 150 L186 158"/>` +
  `<path d="M30 150 L60 150 L96 160 L150 150"/>` +
  `<path d="M96 160 L104 208"/>` +
  `<path d="M18 98 L60 150"/>` +
  `</g>` +
  `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M98 34 L108 104 L84 132 L140 196" stroke="#f4f4f5" stroke-width="25"/>` +
  `<path d="M98 34 L108 104 L84 132 L140 196" stroke="#a77f22" stroke-width="21"/>` +
  `<path d="M98 34 L108 104 L84 132 L140 196" stroke="#d4af37" stroke-width="16"/>` +
  `</g>` +
  `</svg>`;

/** The full lockup: the mark and the LODE wordmark. viewBox 0 0 744 224. */
export const LODE_LOGO_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 744 224" fill="none" role="img" aria-label="Lode">` +
  `<path d="M92 16 L138 30 L180 64 L210 112 L186 158 L150 196 L104 208 L64 192 L30 150 L18 98 L44 46 Z" fill="#0c0c0e"/>` +
  `<path d="M180 64 L210 112 L186 158 L150 150 L150 96 Z" fill="#1c1c22"/>` +
  `<path d="M92 16 L138 30 L118 70 L80 60 L44 46 Z" fill="#17171c"/>` +
  `<path d="M30 150 L64 192 L104 208 L96 160 L60 150 Z" fill="#050506"/>` +
  `<g stroke="#f4f4f5" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">` +
  `<path d="M44 46 L80 60 L118 70 L138 30"/>` +
  `<path d="M80 60 L96 112"/>` +
  `<path d="M118 70 L150 96 L210 112"/>` +
  `<path d="M150 96 L150 150 L186 158"/>` +
  `<path d="M30 150 L60 150 L96 160 L150 150"/>` +
  `<path d="M96 160 L104 208"/>` +
  `<path d="M18 98 L60 150"/>` +
  `</g>` +
  `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M98 34 L108 104 L84 132 L140 196" stroke="#f4f4f5" stroke-width="25"/>` +
  `<path d="M98 34 L108 104 L84 132 L140 196" stroke="#a77f22" stroke-width="21"/>` +
  `<path d="M98 34 L108 104 L84 132 L140 196" stroke="#d4af37" stroke-width="16"/>` +
  `</g>` +
  `<g fill="#0c0c0e">` +
  `<path d="M250 50 H282 V138 H334 V170 H250 Z"/>` +
  `<path fill-rule="evenodd" d="M356 110 a60 60 0 1 0 120 0 a60 60 0 1 0 -120 0 Z M388 110 a28 28 0 1 1 56 0 a28 28 0 1 1 -56 0 Z"/>` +
  `<path fill-rule="evenodd" d="M498 50 H556 C600 50 618 78 618 110 C618 142 600 170 556 170 H498 Z M530 78 H552 C578 78 588 92 588 110 C588 128 578 142 552 142 H530 Z"/>` +
  `<path d="M636 50 H712 V82 H668 V94 H702 V126 H668 V138 H712 V170 H636 Z"/>` +
  `</g>` +
  `</svg>`;
