// Content for the search-friendly part of each page. The build turns every
// entry into its own URL (the home page is slug ""), with its own title,
// description and text below the comparison tool.

export interface PageFaq {
  q: string;
  a: string;
}

export interface Page {
  slug: string;
  /** Short name used in links between pages. */
  name: string;
  title: string;
  description: string;
  h1: string;
  intro: string[];
  stepsTitle: string;
  steps: string[];
  faq: PageFaq[];
  /** Hint shown above the empty editor. */
  hint: string;
  /** How the tool starts on this page. */
  start?: { lang?: string; data?: boolean; image?: boolean; prose?: boolean };
}

const privacyFaq: PageFaq = {
  q: "Is my text uploaded anywhere?",
  a: "No. The comparison runs entirely in your browser, and nothing you paste or open is sent to a server. There are no ads, analytics or cookies. If you copy a share link, the text is packed into the link itself, in the part after the # that browsers never send to a server.",
};

const freeFaq: PageFaq = {
  q: "Is it really free?",
  a: "Yes, with no account, no limits and no paid tier. The code is open source under the MIT license, so anyone can host their own copy.",
};

export const pages: Page[] = [
  {
    slug: "",
    name: "Text compare",
    title: "Text Compare: Free Online Diff Checker, No Ads | text.compare",
    description:
      "Compare two texts and see every change, highlighted by word or character. Free, no ads, no sign-up, and your text never leaves your browser. Works with code, documents, JSON, PDF and Word files.",
    h1: "Compare text online and see exactly what changed",
    intro: [
      "Paste two versions of any text and text.compare highlights every difference: whole lines that were added or removed, the exact words that changed inside a line, and blocks that were moved rather than rewritten.",
      "It works for code, contracts, essays, configuration files and logs, and it opens Word, Excel, PDF and image files too. Everything happens in your browser, so private documents stay on your device.",
    ],
    stepsTitle: "How to compare two texts",
    steps: [
      "Paste the original text on the left and the changed text on the right, or drop two files onto the page.",
      "Differences appear straight away. Press F7 or use the arrows to step through each change.",
      "Adjust what counts as a change in Options, then copy a link, download a .patch, or export a report.",
    ],
    faq: [
      privacyFaq,
      freeFaq,
      {
        q: "What does moved text look like?",
        a: "When a block of lines appears in both versions but in a different place, it is shown in violet with a tag saying where it moved to, instead of a red deletion and a separate green addition. Click the tag to jump to the other copy.",
      },
      {
        q: "Can it ignore whitespace, case or timestamps?",
        a: "Yes. Options can ignore upper and lower case, spaces at line ends, all whitespace, or blank lines. You can also ignore anything matching a pattern, with ready-made ones for dates and times, GUIDs, hex values and numbers.",
      },
    ],
    hint: "Paste or drop text on both sides to compare. Word, Excel, PDF and image files work too. Nothing leaves your browser.",
  },
  {
    slug: "json-compare",
    name: "JSON compare",
    title: "Compare JSON Online: Structural JSON Diff | text.compare",
    description:
      "Compare two JSON documents by structure. Key order is ignored, lists of objects are matched by id, and every added, removed or changed value is listed by its path. Free and private.",
    h1: "Compare JSON online",
    intro: [
      "Paste two JSON documents to see the differences line by line with syntax highlighting, then switch to the Data tab for a structural comparison. The Data view lists each change by its path, such as items[id=3].price, and ignores key order, so reformatted or reordered JSON only shows real changes.",
      "Lists of objects are matched by an id, key, uuid or name field when every item has one, so an item that moved within an array isn't reported as changed.",
    ],
    stepsTitle: "How to compare JSON",
    steps: [
      "Paste or drop the two JSON files, one on each side.",
      "Open the Data tab to see changes by path, or stay in the text view to see them in place.",
      "Use Tools, Format JSON and sort keys to line both files up if their formatting differs.",
    ],
    faq: [
      {
        q: "Does key order matter?",
        a: "Not in the Data view: two objects with the same keys and values are equal whatever order the keys are in. In the text view, use Tools, Format JSON and sort keys to normalise both sides first.",
      },
      {
        q: "How are arrays compared?",
        a: "If every item in both arrays is an object with a unique id, key, _id, uuid, code or name field, items are matched by that field. Otherwise they are compared by position.",
      },
      privacyFaq,
    ],
    hint: "Paste or drop two JSON files. Open the Data tab to compare them by structure.",
    start: { lang: "JSON" },
  },
  {
    slug: "pdf-compare",
    name: "PDF compare",
    title: "Compare PDF Files Online: Find Text Differences | text.compare",
    description:
      "Compare the text of two PDF files and see every changed word. Free, no upload: the PDFs are read in your browser. Export a redline report or print it as a PDF.",
    h1: "Compare two PDF files",
    intro: [
      "Drop two PDFs to compare their text. text.compare extracts the text of each page in your browser, then highlights every word that was added, removed or changed, and shows paragraphs that moved.",
      "Because the files are never uploaded, it is safe for contracts, statements and other private documents. When you're done, export a redline report to send to someone, or print it as a PDF.",
    ],
    stepsTitle: "How to compare PDF files",
    steps: [
      "Drop the original PDF on the left half of the page and the new version on the right, or use Open file on each side.",
      "The text of both is extracted and compared, with document mode on for easy reading.",
      "Step through changes with F7, then use Export to download or print a report.",
    ],
    faq: [
      {
        q: "Can it compare scanned PDFs?",
        a: "Only if the PDF contains selectable text. Scanned pages are images, so there is no text to compare; run them through OCR first.",
      },
      {
        q: "Does it compare layout, fonts or images inside the PDF?",
        a: "No, it compares the words. To compare how two pages look, save them as images and use the image comparison.",
      },
      privacyFaq,
    ],
    hint: "Drop two PDF files, one on each side, to compare their text. They are read in your browser, not uploaded.",
    start: { prose: true },
  },
  {
    slug: "word-compare",
    name: "Word compare",
    title: "Compare Word Documents Online (.docx) | text.compare",
    description:
      "Compare two Word documents and see every changed word, like track changes after the fact. Free and private: .docx files are read in your browser, never uploaded.",
    h1: "Compare two Word documents",
    intro: [
      "Drop two .docx files to see what changed between them, even when track changes wasn't turned on. Each paragraph is compared, with changed words highlighted and moved paragraphs marked.",
      "The documents are read in your browser, so drafts, contracts and reports stay private. Export the result as a redline report or print it to PDF.",
    ],
    stepsTitle: "How to compare Word documents",
    steps: [
      "Drop the original .docx on the left and the revised one on the right.",
      "Read the differences in document mode, with changes shown word by word.",
      "Export a report or print it as a PDF to share the changes.",
    ],
    faq: [
      {
        q: "Does it work with .doc files?",
        a: "Only the newer .docx format. Open an older .doc file in Word or LibreOffice and save it as .docx first.",
      },
      {
        q: "Does it compare formatting?",
        a: "No. It compares the text of each paragraph, which is usually what matters when checking a revision.",
      },
      privacyFaq,
    ],
    hint: "Drop two Word (.docx) files, one on each side. They are read in your browser, not uploaded.",
    start: { prose: true },
  },
  {
    slug: "excel-compare",
    name: "Excel and CSV compare",
    title: "Compare Excel and CSV Files Online | text.compare",
    description:
      "Compare two spreadsheets or CSV files by row and column. Rows are matched by a key column, changed cells are highlighted, and added or removed columns are listed. Free and private.",
    h1: "Compare Excel and CSV files",
    intro: [
      "Drop two .xlsx, .csv or .tsv files and open the Data tab to compare them as tables. Rows are matched by the first column when it holds a unique key, so sorting or reordering rows doesn't show up as a change. Each changed cell shows its old and new value.",
      "Columns are matched by their header, and any column that was added or removed is listed separately. Excel workbooks are converted to CSV in your browser; nothing is uploaded.",
    ],
    stepsTitle: "How to compare spreadsheets",
    steps: [
      "Drop the two files, one on each side. Excel sheets are turned into CSV text.",
      "Open the Data tab to see added, removed and changed rows.",
      "Switch back to Side by side to see the raw text differences.",
    ],
    faq: [
      {
        q: "How are rows matched?",
        a: "By the first column when its values are unique in both files, such as an id or SKU. Otherwise rows are matched by their order.",
      },
      {
        q: "What about workbooks with several sheets?",
        a: "Each sheet is included with a heading. The Data view works best with one sheet per file, so export the sheet you care about as CSV if needed.",
      },
      privacyFaq,
    ],
    hint: "Drop two Excel, CSV or TSV files, then open the Data tab to compare rows and cells.",
    start: { data: true },
  },
  {
    slug: "image-compare",
    name: "Image compare",
    title: "Compare Images Online: Slider and Pixel Difference | text.compare",
    description:
      "Compare two images side by side, with a slider, as an overlay, or as a pixel difference map that shows exactly which pixels changed. Free, and images stay in your browser.",
    h1: "Compare two images",
    intro: [
      "Drop two images to compare them four ways: side by side, with a slider you drag across, as an overlay with adjustable opacity, or as a difference map that marks every changed pixel in magenta and tells you what share of the image changed.",
      "It is useful for checking screenshots, design revisions and visual regressions. Images are opened in your browser and never uploaded.",
    ],
    stepsTitle: "How to compare images",
    steps: [
      "Drop the original image on the left and the new one on the right.",
      "Choose Side by side, Slider, Overlay or Difference.",
      "Read the share of changed pixels in the bar above the images.",
    ],
    faq: [
      {
        q: "Which formats work?",
        a: "PNG, JPEG, GIF, WebP, AVIF, BMP, SVG and ICO, or anything else your browser can display.",
      },
      {
        q: "What if the images are different sizes?",
        a: "They are lined up at the top-left corner, and the size difference is shown above the images.",
      },
      privacyFaq,
    ],
    hint: "Drop two images, one on each side, to compare them.",
    start: { image: true },
  },
  {
    slug: "code-compare",
    name: "Code compare",
    title: "Compare Code Online: Diff Checker With Syntax Highlighting | text.compare",
    description:
      "Compare two versions of source code with syntax highlighting for 100+ languages, moved-block detection, merge arrows and .patch export. Free, private and open source.",
    h1: "Compare code online",
    intro: [
      "Paste two versions of a file to see a diff with syntax highlighting for more than 100 languages, detected automatically. Moved functions are marked as moves instead of big deletions and additions, and both sides are editable, with arrows to copy a change across.",
      "Export a standard unified .patch that git apply understands, or ignore noise such as whitespace, case, timestamps or generated ids.",
    ],
    stepsTitle: "How to compare code",
    steps: [
      "Paste or drop the two versions of the file.",
      "Step through changes with F7, and use the arrows between the sides to merge blocks.",
      "Download a .patch, copy the diff, or copy a link to share it.",
    ],
    faq: [
      {
        q: "Can I apply the result with git?",
        a: "Yes. Export, Download .patch produces a standard unified diff that works with git apply and patch.",
      },
      {
        q: "Which languages are highlighted?",
        a: "More than 100, including JavaScript, TypeScript, Python, C#, Java, Go, Rust, C and C++, PHP, Ruby, SQL, HTML, CSS, YAML and shell scripts. The language is picked from the file name or the code itself, or you can choose it.",
      },
      freeFaq,
    ],
    hint: "Paste or drop two versions of a file to compare them with syntax highlighting.",
  },
];

// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const pageUrl = (site: string, p: Page) => `${site.replace(/\/$/, "")}/${p.slug ? p.slug + "/" : ""}`;

export function renderHead(p: Page, site: string): string {
  const url = pageUrl(site, p);
  const image = `${site.replace(/\/$/, "")}/og-image.png`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: p.slug ? `${p.name} by text.compare` : "text.compare",
    url,
    description: p.description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any (runs in a web browser)",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    license: "https://opensource.org/licenses/MIT",
    author: { "@type": "Person", name: "James Patton", url: "https://jamesclaypatton.com" },
  };
  return [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="text.compare" />`,
    `<meta property="og:title" content="${esc(p.title.replace(/ \| text\.compare$/, ""))}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Two texts side by side with the changes highlighted" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].join("\n    ");
}

export function renderAbout(p: Page, all: Page[], prefix: string): string {
  const others = all.filter((o) => o !== p);
  return `<section class="about" aria-labelledby="about-title">
      <div class="about-inner">
        <h1 id="about-title">${esc(p.h1)}</h1>
        ${p.intro.map((t) => `<p class="lede">${esc(t)}</p>`).join("\n        ")}
        <h2>${esc(p.stepsTitle)}</h2>
        <ol class="steps">
          ${p.steps.map((s) => `<li>${esc(s)}</li>`).join("\n          ")}
        </ol>
        <h2>Questions</h2>
        <div class="faq">
          ${p.faq.map((f) => `<h3>${esc(f.q)}</h3>\n          <p>${esc(f.a)}</p>`).join("\n          ")}
        </div>
        <nav class="more" aria-label="Other comparisons">
          <h2>Other comparisons</h2>
          <ul>
            ${others.map((o) => `<li><a href="${prefix}${o.slug ? o.slug + "/" : ""}">${esc(o.name)}</a></li>`).join("\n            ")}
          </ul>
        </nav>
      </div>
    </section>`;
}
