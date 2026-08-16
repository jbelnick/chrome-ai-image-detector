#!/usr/bin/env node
/**
 * Independent screenshot / UI / illustration probes.
 * Not the PR 12 holdout. Not a KEEP scalar. Used to see the
 * isGraphic trap on ordinary real UI and to check that actual
 * AI illustrations still flag.
 */
import { createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(root, "eval/data/ui-probe");
const UA =
  "GrainUiProbe/1.0 (https://github.com/jbelnick/chrome-ai-image-detector; product-lane)";

/**
 * Commons titles that are NOT in PR 12 screenshot_ui.
 * Charlesworth is included only as a muted-scan regression check.
 */
const PROBES = [
  {
    id: "real_blender",
    label: "real",
    role: "software-ui",
    title: "File:Blender 2.92 screenshot.png",
    width: 900,
    notes: "Real Blender 2.93 UI screenshot (not in holdout).",
  },
  {
    id: "real_inkscape",
    label: "real",
    role: "software-ui",
    title: "File:Inkscape screenshot 02.png",
    width: 900,
    notes: "Real Inkscape 1.0 UI screenshot (not in holdout).",
  },
  {
    id: "real_libreoffice",
    label: "real",
    role: "software-ui",
    title: "File:LibreOffice Writer 7.5.0 Windows10.png",
    width: 900,
    notes: "Real LibreOffice Writer UI (not in holdout).",
  },
  {
    id: "real_vlc",
    label: "real",
    role: "software-ui",
    title: "File:VLC Media Player Screenshot.png",
    width: 900,
    notes: "Real VLC 3 UI screenshot (not in holdout).",
  },
  {
    id: "real_wiki_main",
    label: "real",
    role: "web-ui",
    title: "File:Screenshot of the Main Page on the English Wikipedia - Wikipedia 25.png",
    width: 900,
    notes: "Real English Wikipedia article screenshot (not the holdout RU/mobile ones).",
  },
  {
    id: "real_line_chart",
    label: "real",
    role: "chart",
    title: "File:Saudi Arabia CO2 emissions (metric tons per capita).png",
    width: 900,
    notes: "Real scientific line chart (not the holdout bar/pie set).",
  },
  {
    id: "real_org_chart",
    label: "real",
    role: "diagram",
    title: "File:DOE Org Chart Feb 2022.png",
    width: 900,
    notes: "Real org-chart diagram (not in holdout).",
  },
  {
    id: "ai_dalle_shiba",
    label: "ai",
    role: "illustration",
    title: "File:A Shiba Inu dog wearing a beret and black turtleneck DALLE2.jpg",
    width: 900,
    notes: "Famous DALL-E illustration. Must stay AI.",
  },
  {
    id: "ai_dalle_astronaut",
    label: "ai",
    role: "illustration",
    title: "File:DALL-E Flow a horse riding an astronaut.png",
    width: 900,
    notes: "DALL-E 2 illustration. Must stay AI.",
  },
  {
    id: "ai_midjourney_castle",
    label: "ai",
    role: "illustration",
    title: "File:Midjourney - Dark Castle with Dragon.png",
    width: 900,
    notes: "Midjourney-style illustration. Must stay AI.",
  },
  {
    id: "real_simple_pie",
    label: "real",
    role: "chart",
    title: "File:Pie Chart FTingetWikiEdit 2.png",
    width: 800,
    notes: "Simple real pie chart (not holdout Pie-chart.jpg).",
  },
  {
    id: "real_two_bar",
    label: "real",
    role: "chart",
    title: "File:Comparing two bar charts.png",
    width: 800,
    notes: "Simple real bar-chart comparison (not in holdout).",
  },
  {
    id: "real_win95",
    label: "real",
    role: "software-ui",
    title: "File:Windows 95 PC MINI.png",
    width: 800,
    notes: "Old limited-palette Windows 95 UI screenshot.",
  },
  {
    id: "real_flowchart",
    label: "real",
    role: "diagram",
    title: "File:Flowchart-6.png",
    width: 800,
    notes: "Real flowchart diagram (not in holdout).",
  },
  {
    id: "real_charlesworth",
    label: "real",
    role: "historic-scan",
    title: "File:Mrs Winifred Charlesworth.jpg",
    width: 470,
    notes: "Charlesworth 1910s — muted-scan regression check. Must not return to AI 99%.",
  },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchOk(url, { tries = 8 } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "*/*" },
        redirect: "follow",
      });
      if (res.ok) return res;
      last = new Error(`${url} ${res.status}`);
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after")) || 2 ** i;
        await new Promise((r) => setTimeout(r, Math.min(30_000, retryAfter * 1000)));
        continue;
      }
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  throw last;
}

async function commonsThumbUrl(title, width) {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: String(width || 800),
    format: "json",
  });
  const api = `https://commons.wikimedia.org/w/api.php?${params}`;
  const data = await (await fetchOk(api)).json();
  const page = Object.values(data.query?.pages || {})[0];
  const info = (page?.imageinfo || [])[0];
  if (!info) throw new Error(`Commons has no imageinfo for ${title}`);
  return { url: info.thumburl || info.url, mime: info.mime || "" };
}

async function downloadTo(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetchOk(url);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  await mkdir(destDir, { recursive: true });
  const landed = [];
  for (const probe of PROBES) {
    const dest = join(destDir, `${probe.id}.jpg`);
    if (await exists(dest)) {
      console.log(`exists ${probe.id}`);
      landed.push({ ...probe, path: dest, skipped: true });
      continue;
    }
    try {
      const info = await commonsThumbUrl(probe.title, probe.width);
      const tmp = `${dest}.part`;
      await downloadTo(info.url, tmp);
      await sharp(tmp).jpeg({ quality: 88 }).toFile(dest);
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp).catch(() => {});
      console.log(`ok ${probe.id} ← ${probe.title}`);
      landed.push({ ...probe, path: dest, skipped: false });
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.error(`FAIL ${probe.id}: ${err.message || err}`);
    }
  }
  await writeFile(
    join(destDir, "manifest.json"),
    JSON.stringify({ note: "Independent UI probe. Not the PR 12 holdout.", images: landed }, null, 2),
  );
  console.log(`landed ${landed.length}/${PROBES.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
