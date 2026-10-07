# tulumdao.com

The site for [OrchestraOS](https://github.com/Tulum-DAO/orchestraos), published by Tulum DAO.
Astro, with a Three.js cenote that loads after first paint.

## Docs come from the OrchestraOS repo

`src/content/docs/` is written by `scripts/sync-docs.mjs` from `Tulum-DAO/orchestraos` at the
commit pinned in `docs.lock.json`. The install command in the hero is read out of
`docs/INSTALL.md` by the same script. Don't edit those files by hand: `npm run build` checks them
against the lock and refuses if they differ.

```bash
npm install
npm run sync-docs -- --ref main   # pin the latest main and re-sync
npm run dev
npm run build                     # checks the docs, then builds to dist/
```

The sync refuses to write a doc that contains a private hostname or tailnet address.

## Rules for the page

- The repo link and install command are static HTML, readable with JS off and on a phone.
- The 3D is progressive enhancement: it loads on idle after `load`, never under
  `prefers-reduced-motion`, and the page is complete without it.
- The hero text is painted opaque on the first frame (it is the LCP element).

Fonts: Bricolage Grotesque and IBM Plex Mono, both SIL OFL (see `public/fonts/`).

## The whitepaper draft

`public/whitepaper/` holds The Self-Tended Fleet draft, copied from the `tulum-dao-whitepaper`
seat's build (`.workspace/tulum-dao-whitepaper/web/` on the operator's VPS). It is served at
`/whitepaper/` UNLINKED and noindex (meta tag + `X-Robots-Tag` in `netlify.toml`) until Shaw
approves publishing. Don't link it from the nav, the home page or OG tags.
