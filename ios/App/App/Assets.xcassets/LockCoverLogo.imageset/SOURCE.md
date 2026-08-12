# LockCoverLogo — 393x147 is the REAL master. Do not upscale.

`lockcover-logo.png` is the original upload from:

    https://apexbusiness.pro/wp-content/uploads/2025/12/LogoApex.png

**393x147, transparent PNG.** This is the largest version that exists anywhere,
and it is the same file the login screen uses.

## Do not go looking for a bigger one — this was already researched (2026-08-12)

- `Splash.imageset` is the stock Capacitor placeholder (blue X on white).
- `icons/icon-512.png` is 512x512 but is the triangle mark ONLY, no wordmark.
- WordPress serves a `-300x112` variant but 404s on `-768`, `-1024` and
  `-scaled`, which it would only generate from a larger source. 393x147 is
  therefore the original, not a resized derivative.
- No vector exists in the repo, the vault, R2, or either clone.

A proper master needs the original vector from whoever designed the logo. That
is a separate ask, already blocking the production app icon.

## Consequence for layout

Because 393px is all there is, `ApexLockCover` caps the rendered width at
**300pt** (`logoMaxWidth`) instead of scaling to a fraction of the screen
without limit. Above roughly that width the upscaling becomes visible and the
logo reads as cheap. The 62% figure only applies on screens narrow enough that
62% is under the cap.

It is bundled rather than hotlinked because a native cover that must paint on
the first frame cannot depend on a network fetch.
