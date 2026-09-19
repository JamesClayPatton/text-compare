# text.compare

Compare two texts and see exactly what changed. No ads, no tracking, no sign-up.
Everything runs in your browser, so the text you paste is never uploaded anywhere.

![Side-by-side comparison of two JSON files](docs/screenshot-light.png)

## Features

- **Side by side or unified** views, with word- and character-level highlighting inside changed lines
- **Editable on both sides**, with undo, find and replace, and arrows that copy a block from one side to the other
- **Syntax highlighting** for 100+ languages, detected from the file name or the text itself
- **Options** to ignore case, whitespace at line ends, all whitespace, or blank lines
- **Jump between changes** with <kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F7</kbd> (or <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>), plus a change map beside the editor you can click
- **Hide unchanged lines** to focus on what's different
- **Open or drop files** (drop two at once to compare them), with UTF-8, UTF-16 and Windows-1252 detection
- **Export** as a standard `.patch` file, copy the diff, download either side, or print
- **Share links** that carry the text inside the link itself, with nothing stored on a server
- **Tools** to format JSON with sorted keys, sort lines, strip whitespace at line ends, and swap sides
- **Light and dark themes**, a phone-friendly layout, and offline support once installed as an app

## Privacy

The site is a set of static files. It has no backend, analytics, cookies, web fonts or third-party
scripts, and the included server configs set a Content Security Policy that blocks requests to other
sites. A copied link keeps the text in the part after `#`, which browsers never send to the server.
"Remember my text on this device" is off by default and only uses your browser's local storage.

## Host your own copy

You need [Node.js](https://nodejs.org) 20 or newer.

```sh
git clone https://github.com/jamesclaypatton/text-compare.git
cd text-compare
npm install
npm run build        # produces the static site in dist/
```

Then serve `dist/` with any static web server. Some options:

**Caddy**

```caddyfile
text.example.com {
	root * /path/to/text-compare/dist
	encode gzip zstd
	header /assets/* Cache-Control "public, max-age=31536000, immutable"
	file_server
}
```

**Docker** (nginx, with caching and security headers set up)

```sh
docker build -t text-compare .
docker run -d -p 8080:80 --name text-compare text-compare
```

**GitHub Pages** (free): fork this repo, go to *Settings → Pages* and set *Source* to
*GitHub Actions*, then run the *Deploy to GitHub Pages* workflow from the *Actions* tab.

The build uses relative paths, so it works from a domain root or from a sub-folder.

## Development

```sh
npm run dev          # local dev server with hot reload
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright; run `npx playwright install chromium` once)
```

| Path | What it does |
| --- | --- |
| `src/diff-core.ts`, `src/seq-diff.ts` | Line diff (Myers), stats and `.patch` output |
| `src/normalize.ts` | Comparison options (case, whitespace, blank lines) |
| `src/merge-override.ts` | Applies those options to the editor's diff |
| `src/editor.ts` | The CodeMirror side-by-side and unified views |
| `src/share.ts` | Encoding texts into share links |
| `src/lang.ts` | Language detection |
| `src/main.ts` | Page wiring: toolbar, files, export, theme |

Built with [CodeMirror 6](https://codemirror.net) and [lz-string](https://github.com/pieroxy/lz-string).

## License

[MIT](LICENSE). Use it, change it, host it.
