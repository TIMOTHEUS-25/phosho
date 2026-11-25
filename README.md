# PhoSho!

A small drag-and-drop app for Mac and Windows that turns an InDesign document into a layered Photoshop file.

## Requirements

**Adobe InDesign** and **Adobe Photoshop** must be installed on the machine. The app drives both in the background. It picks the newest installed version of each.

On first use, macOS asks whether "PhoSho!" may control InDesign and Photoshop. Click **OK**. If you denied it, go to *System Settings → Privacy & Security → Automation* and turn it on.

## How to use it

1. Drop a `.indd` file onto the window, or click **Choose file…**.
2. Click pages to select them. Shift-click selects a range; **All** and **None** are at the top. Hover over a page or click it to see it large on the right.
3. Fix any **missing links**:
   - **Relink…** lets you pick the file yourself.
   - **Search a folder…** looks for every missing file in a folder, such as a server share.
   - Missing files that sit next to the document are found automatically.
   - Click a file's path to show the full path (on a server too), and select it to copy. Click again to collapse it.
4. Click **Convert**. The PSD is saved next to the InDesign file. Use **Change…** to save it somewhere else.
5. **← Back** (top left), or **Convert another file** on the result screen, returns you to the drop screen.

## What you get

- **One PSD** at 300 ppi in RGB, with **one artboard per page**, named "Page 1", "Page 2" and so on.
- Inside each artboard, a **group for each InDesign layer**. Hidden InDesign layers and objects stay hidden.
- **Every object is a layer**:

| InDesign | Photoshop |
|---|---|
| Text frame | **Live, editable text layer** with a **red** layer label, with the same font (by PostScript name), size, leading, tracking, colour, alignment, indents, paragraph spacing, caps, super/subscript, underline and strikethrough. Mixed styles inside a frame are kept. |
| Linked image (PSD, TIFF, JPG, PNG, AI, PDF, EPS…) | **Linked Smart Object** pointing at the *same* file path (local disk or server), cropped by a vector mask that matches the frame's shape. |
| Placed PSD or TIFF with some layers shown or hidden in **Object Layer Options** (for example a product placed twice: one copy showing only its shadow and set to Multiply, the other showing only the product) | The same layers shown and hidden, with the same blend mode. Photoshop can't show different layers on different copies of one linked file, so these copies become **embedded** smart objects containing every layer of the original. Toggle layers inside them any time. The result screen lists the original file path. Copies whose layers you didn't change stay linked. For a placed PDF, AI or EPS with layers switched, InDesign's render is used instead, because Photoshop can't switch those layers. |
| Missing link that you didn't relink | Embedded smart object made from InDesign's preview. Use *Replace Contents* later. |
| Embedded image | Embedded smart object |
| Shapes, lines, frame fills and strokes | Embedded smart object (rasterized at 300 ppi) |
| Group | **A folder** with the group's contents as live layers. Folders are named automatically (see *Folder names* below). A group that holds only one object gets no folder: the object takes its place. |
| Objects pasted inside a frame | **A folder masked by the frame's shape** (a vector mask), holding the frame's fill and the live contents. The frame's stroke sits on top. |
| Rounded and other live corners | Kept in the frame's vector mask. |
| Master (parent) page items | Included on each page |
| Rotation, shear (skew) and flip | The same transform applied to the layer. **Text stays live and editable**, and linked images stay linked. |
| Drop shadow, inner shadow, outer glow, inner glow, bevel & emboss, satin | **Live, editable layer styles** with the same colour, opacity, blend mode, angle, distance, size and spread. This works on text, images, shapes and groups. |
| Feathers (basic, directional, gradient) | On linked images, a **layer mask** with the same fade (the image stays linked). On text, a gradient feather becomes a layer mask; basic and directional feathers on text are left off, and you'll see a note. On shapes they are baked into the pixels. |
| Opacity and blend mode | Layer opacity and blend mode |

## Good to know

- **Fonts:** Photoshop needs the same fonts installed. Fonts that only exist in an InDesign "Document Fonts" folder must be installed on the system first. Missing fonts are listed before and after conversion. The text stays editable regardless.
- **Line breaks:** Photoshop composes type slightly differently from InDesign. With **Keep InDesign's line breaks** ticked (the default), a soft return (Shift+Return) is added wherever InDesign wraps a line, so every line breaks exactly as in InDesign, including hyphenation and justified text. The text stays editable, but it won't rewrap by itself after you change the words. Untick it to let Photoshop rewrap freely. For justified paragraphs, the lines before the last become a "justify all" paragraph, and the last line becomes its own paragraph.
- **Text position:** each text layer is lined up with where InDesign actually draws the text, so vertical justification, first-baseline settings and insets match. Tabs, including the tab after a bullet, become an em space tracked to the same width, because Photoshop has no tab stops.
- **Folder names:** a group named in InDesign's Layers panel keeps that name. Otherwise the folder takes the name of its object style, or its biggest text ("Card title group"), or its first image. When folders are nested, the outer one says what it adds ("Card title group + 1 more"). Unnamed shapes are named by type and fill swatch or object style, such as "Rectangle · Brand Red".
- **Rasterized instead of live text:** text frames that contain tables, and vertical text, are rasterized (you'll see a note). Multi-column frames become a single text box.
- **Locked linked files:** if Photoshop reports a linked file as locked (common on servers, or when another app has the file open), the app waits and retries. If the lock stays, it embeds the full-resolution original and relinks it to the same path. If even that is refused, the image stays embedded at full resolution and the result screen tells you which ones. Use *Layer → Smart Objects → Relink to File* once the file is free.
- **Very large documents:** if all the artboards together exceed 30,000 px, the file is saved as `.psb`, Photoshop's large-document format.
- **Your original file is never modified.** The app works on a temporary copy that is deleted straight away.
- **Effects on a frame with a fill:** InDesign applies object effects to the frame as a whole. Shadows and outer glows go on the frame's fill layer (the bottom layer), and inner effects go on the image. On a filled text frame, all of them go on the background, as InDesign draws them. Satin can look slightly different because Photoshop uses a different contour.
- Avoid using InDesign or Photoshop while a conversion is running.

## Building from source

The app icon is generated from the artwork in `build/` (`icon.png` for macOS, `icon-win.png` for Windows). The splash screen is `renderer/assets/splash.jpg`, shown for at least 2 seconds at startup while the main window loads behind it.


```bash
npm install
npm start            # run in development
npm run dist:mac     # → dist/PhoSho-1.0.1-universal.dmg  (Apple Silicon + Intel)
npm run dist:win     # → dist/PhoSho-Setup-1.0.1.exe  and dist/PhoSho-1.0.1-portable.exe
```

The builds are not code-signed:

- **macOS:** the first time, right-click the app, choose **Open**, then confirm.
- **Windows:** SmartScreen may warn. Click *More info → Run anyway*.

## How it works

- `jsx/id_analyze.jsx` (runs in InDesign): renders page thumbnails and lists links and fonts.
- `jsx/id_extract.jsx` (runs in InDesign): walks every object on the chosen pages and writes a JSON manifest with text runs, geometry, link paths and clip paths. Anything that can't stay live is exported as PNG.
- `jsx/ps_build.jsx` (runs in Photoshop): creates the artboards, live text layers, linked smart objects and vector masks, then saves the PSD.
- `src/adobe.js` runs those scripts through AppleScript on macOS and COM/PowerShell on Windows.

To test without the UI, run `node test/run_test.js` (sample) or `node test/run_layers.js` (stacking order across layers and groups), or `node test/run_effects.js` (effects, rotation, shear and flip; `test/make_effects.jsx` builds `test/effects.indd`), or `node test/run_psdlayers.js` (Object Layer Options: the product-and-shadow set-up; `test/make_product.jsx` builds the PSD in Photoshop and `test/make_psdlayers.jsx` builds the InDesign file), or `node test/run_masks.js` (masks, corners, feathers, pasted-inside, text placement, group names; built by `test/make_masks.jsx`). `node test/compare.js <file.indd> <file.psd> [pageIndex]` renders the InDesign page and the PSD artboard side by side with a difference map in `test/out/` (set `CMP_RES=300` for full resolution) against `test/sample.indd`. `test/make_sample.jsx` rebuilds that sample document.
