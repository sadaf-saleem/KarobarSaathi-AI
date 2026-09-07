/**
 * KarobarSaathi AI — Receipt AI Service (multi-engine OCR pipeline)
 *
 * Pipeline:
 *   extractFromImage(filePath)
 *     1. Preprocess: resize → grayscale → contrast-normalize → adaptive
 *        threshold (3 variants) → ruling-line removal. Handles phone photos
 *        of handwritten receipts on lined paper with shadows.
 *     2. Full-page OCR (Tesseract.js, PSM 6 + PSM 11) → text + word boxes.
 *     3. Windows native OCR (Windows.Media.Ocr — handwriting-capable) runs
 *        in parallel as a second opinion (optional, Windows only).
 *     4. If the fast parse looks solid (printed receipt) → done.
 *        Otherwise: line-region detection from word boxes → strip re-OCR
 *        of every line at high upscale with multiple threshold variants.
 *     5. Ensemble parsing: fuzzy label matching, cross-reading voting,
 *        OCR digit-confusion correction ("3l"→31, "n0de"→2026), currency
 *        formats (Rs. 3,000 / Rs 3'000 / PKR 3000 / روپے 3000).
 *
 * No fabricated values: fields that cannot be confidently read are left
 * empty and flagged in `lowConfidenceFields` for the user to review.
 *
 * To swap in a cloud AI provider (OpenAI Vision, Google Gemini Vision):
 *   Replace the Tesseract/Windows engine calls with your provider's vision
 *   API and keep the parser. Configuration lives in environment variables
 *   (see README): AI_PROVIDER, OPENAI_API_KEY, GOOGLE_AI_API_KEY, GROQ_API_KEY.
 */

import { createWorker, PSM } from 'tesseract.js';
import Jimp from 'jimp';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── AI Vision fallback (env-driven) ────────────────────────
const AI_PROVIDER  = (process.env.AI_PROVIDER || 'ocr').toLowerCase().trim();
const OPENAI_KEY   = process.env.OPENAI_API_KEY || '';
const GEMINI_KEY   = process.env.GOOGLE_AI_API_KEY || '';
const GROQ_KEY     = process.env.GROQ_API_KEY || '';

// Circuit breaker: stops retrying models that are persistently unavailable.
// After 2 consecutive failures (any type: 429/503/timeout), the model is
// marked dead for the remainder of the server process. Resets on success.
const geminiCB = {
  'gemini-3.5-flash-lite': { failures: 0 },
  'gemini-3.8-flash':      { failures: 0 }
};

// Groq circuit breaker — SEPARATE state so Groq failures never disable
// Gemini and vice versa. Vision models on Groq (Llama 3.2 Vision was
// decommissioned by Groq in April 2025): qwen/qwen3.8-27b primary,
// qwen/qwen3.6-27b automatic fallback — both multimodal (image input)
// with JSON-mode support.
const groqCB = {
  'qwen/qwen3.8-27b': { failures: 0 },
  'qwen/qwen3.6-27b': { failures: 0 }
};

if (!['ocr', 'openai', 'google', 'groq', 'demo'].includes(AI_PROVIDER)) {
  console.warn(`[AI] Unknown AI_PROVIDER "${AI_PROVIDER}" — defaulting to ocr (local only).`);
}

/** Detect Urdu/Arabic script characters in text (U+0600-06FF and extended ranges). */
function detectUrduScript(text) {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text || '');
}

/**
 * Check image file metadata (NOT compressed pixel data) for embedded
 * Urdu/Arabic Unicode text.  Only JPEG EXIF/APP markers and PNG text
 * chunks are inspected — the compressed image data region is skipped.
 *
 * The old implementation scanned raw bytes blindly, causing ~100% false
 * positives because JPEG compressed pixel data randomly matches
 * 2-byte UTF-8 Arabic sequences (e.g. 0xD8 0x80-0xBF).
 */
function detectUrduInImage(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 4) return false;

    // ── JPEG: parse marker segments, skip compressed data ──
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let pos = 2;
      while (pos < buf.length - 1) {
        // Every marker starts with 0xFF
        if (buf[pos] !== 0xFF) break;
        const marker = buf[pos + 1];
        // RST and padding markers (0xFF 0x00-0x01, 0xFF D0-D7)
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD7)) {
          pos += 2;
          continue;
        }
        // SOI (0xD8), EOI (0xD9) — no payload
        if (marker === 0xD8 || marker === 0xD9) {
          pos += 2;
          continue;
        }
        // SOS (0xDA) — compressed image data follows; stop scanning
        if (marker === 0xDA) break;
        // All other markers have a 2-byte length prefix
        if (pos + 3 >= buf.length) break;
        const segLen = (buf[pos + 2] << 8) | buf[pos + 3];
        const segStart = pos + 4;
        const segEnd = Math.min(segStart + segLen - 2, buf.length);
        // Scan this metadata segment for Urdu/Arabic UTF-8 text
        if (scanSegmentForUrdu(buf, segStart, segEnd)) return true;
        pos = segStart + segLen - 2;
      }
      return false;
    }

    // ── PNG: check only text chunks (tEXt, iTXt, zTXt) ──
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      let pos = 8; // skip PNG signature
      while (pos + 8 <= buf.length) {
        const chunkLen = (buf[pos] << 24) | (buf[pos+1] << 16) | (buf[pos+2] << 8) | buf[pos+3];
        const type = String.fromCharCode(buf[pos+4], buf[pos+5], buf[pos+6], buf[pos+7]);
        const dataStart = pos + 8;
        // Only scan text-containing chunk types
        if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
          const dataEnd = Math.min(dataStart + chunkLen, buf.length);
          if (scanSegmentForUrdu(buf, dataStart, dataEnd)) return true;
        }
        pos = dataStart + chunkLen + 4; // skip data + CRC
        if (type === 'IEND') break;
      }
      return false;
    }

    // ── Other formats: don't attempt metadata scanning ──
    return false;
  } catch { return false; }
}

/** Scan a byte range within a buffer for UTF-8 encoded Arabic/Urdu script. */
function scanSegmentForUrdu(buf, start, end) {
  for (let i = start; i < end - 1; i++) {
    const b = buf[i];
    // 2-byte UTF-8: Arabic block U+0600-06FF → 0xD8 0x80-0xBF
    if (b === 0xD8 && buf[i + 1] >= 0x80 && buf[i + 1] <= 0xBF) return true;
    // 2-byte UTF-8: Arabic Ext-A U+0750-077F → 0xDD 0x90-0xBF
    if (b === 0xDD && i + 1 < end && buf[i + 1] >= 0x90 && buf[i + 1] <= 0xBF) return true;
    // 3-byte UTF-8: Arabic Presentation Forms
    if (b === 0xEF && i + 2 < end && buf[i + 1] === 0xAD) return true;
    if (b === 0xEF && i + 2 < end && buf[i + 1] === 0xB9 && buf[i + 2] >= 0xB0) return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════

/**
 * Extract structured receipt data from an image file.
 * Returns { extracted, mode, engines, rawText, confidence }
 */
export async function extractFromImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const supportedExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif'];
  if (!supportedExts.includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}. Supported: ${supportedExts.join(', ')}`);
  }

  const tempFiles = [];
  const engines = ['tesseract'];
  let rawTextSoFar = '';

  try {
    // ── Step 1: preprocess ──────────────────────────────
    const inStat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    console.log(`  [AI] Input image: ${path.basename(filePath)} (${inStat ? inStat.size : '?'} bytes)`);
    let prep = await loadAndPreprocess(filePath);
    let gray = prep.gray;
    let w = prep.w;
    let h = prep.h;
    const buildBins = (g, gw, gh) => {
      const win = Math.max(15, Math.floor(Math.min(gw, gh) / 15) | 1);
      const bins = {};
      for (const C of [6, 8, 10, 14, 18]) {
        const b = adaptiveThreshold(g, gw, gh, win, C);
        removeHorizontalRuling(b, gw, gh);
        removeVerticalRuling(b, gw, gh);
        // NOTE: no despeckle here — strip re-OCR of faint cursive is so
        // pixel-fragile that removing even isolated dots changes readings.
        // Noise reduction is applied only to the full-page image below.
        bins[C] = b;
      }
      return bins;
    };
    let bins = buildBins(gray, w, h);
    let binMain = bins[14];
    // Full-page pass gets a despeckled copy (salt noise hurts word boxes)
    const writeFullPage = (bin, gw, gh) => {
      const copy = Uint8Array.from(bin);
      despeckle(copy, gw, gh);
      return writeBinaryImage(copy, gw, gh);
    };
    console.log(`  [AI] Preprocessed: ${w}x${h} grayscale, contrast-normalized, background-cropped when needed, 5 threshold variants`);

    // ── Step 2: full-page OCR (Tesseract) ───────────────
    const fullPath = await writeFullPage(binMain, w, h);
    tempFiles.push(fullPath);

    // Start Windows OCR in parallel (separate process)
    const winFile = await writeWindowsInput(filePath);
    tempFiles.push(winFile);
    const winPromise = runWindowsOcr(winFile).catch((e) => {
      console.log(`  [AI] Windows OCR unavailable: ${String(e.message || e).slice(0, 100)}`);
      return null;
    });

    console.log('  [AI] Full-page OCR pass 1 (block)...');
    let pass1 = await runOcrPass(fullPath, PSM.SINGLE_BLOCK);
    let fullText = pass1.text;
    let words = pass1.words;
    let bestConfidence = pass1.confidence;

    // Orientation rescue: near-total garbage may mean the photo is rotated.
    // (EXIF orientation is already applied by Jimp on read.) Try the other
    // three rotations and keep one only if it clearly scores better.
    if (scoreOcr(fullText, bestConfidence) < 1500) {
      console.log('  [AI] Very low text yield — testing rotated orientations...');
      let bestScore = scoreOcr(fullText, bestConfidence);
      let bestRot = null;
      for (const angle of [90, 180, 270]) {
        const rot = rotateGray(gray, w, h, angle);
        const rBins = buildBins(rot.gray, rot.w, rot.h);
        const rFile = await writeFullPage(rBins[14], rot.w, rot.h);
        tempFiles.push(rFile);
        const rPass = await runOcrPass(rFile, PSM.SINGLE_BLOCK);
        const rScore = scoreOcr(rPass.text, rPass.confidence);
        console.log(`    ${angle}°: score ${rScore} (upright: ${bestScore})`);
        if (rScore > bestScore * 1.5) {
          bestScore = rScore;
          bestRot = rot;
        }
      }
      if (bestRot) {
        gray = bestRot.gray;
        w = bestRot.w;
        h = bestRot.h;
        bins = buildBins(gray, w, h);
        binMain = bins[14];
        const fixFile = await writeFullPage(binMain, w, h);
        tempFiles.push(fixFile);
        pass1 = await runOcrPass(fixFile, PSM.SINGLE_BLOCK);
        fullText = pass1.text;
        words = pass1.words;
        bestConfidence = pass1.confidence;
        console.log(`  [AI] Orientation corrected → re-OCR at ${w}x${h}`);
      }
    }

    // Additional page-segmentation modes for hard pages; keep the best pass
    if (scoreOcr(fullText, bestConfidence) < 4000) {
      console.log('  [AI] Full-page OCR pass 2 (auto + sparse)...');
      for (const psm of [PSM.AUTO, PSM.SPARSE_TEXT]) {
        const p = await runOcrPass(fullPath, psm);
        if (scoreOcr(p.text, p.confidence) > scoreOcr(fullText, bestConfidence)) {
          fullText = p.text;
          words = p.words.length >= words.length ? p.words : words;
          bestConfidence = p.confidence;
        }
      }
    }
    console.log(`  [AI] Full-page OCR: ${Math.round(bestConfidence)}% confidence, ${fullText.replace(/\s/g, '').length} chars, ${words.length} words`);

    // ── Step 3: Windows OCR result ──────────────────────
    let winText = null;
    const winResult = await winPromise;
    if (winResult && winResult.text && /[A-Za-z0-9]/.test(winResult.text)) {
      winText = winResult.text;
      engines.push('windows-ocr');
      console.log(`  [AI] Windows OCR: ${winText.replace(/\s/g, '').length} chars`);
    } else {
      console.log('  [AI] Windows OCR: no usable text — continuing with Tesseract only');
    }

    // ── Raw engine output BEFORE any parser runs (diagnostics) ──
    rawTextSoFar = formatRawText(fullText, winText, null);
    console.log('  [AI] RAW TESSERACT OUTPUT (pre-parser):');
    console.log('  ' + JSON.stringify(fullText));
    console.log(`  [AI] RAW WINDOWS OCR OUTPUT (pre-parser): ${JSON.stringify(winText)}`);

    // ── Step 4: fast parse (printed receipts) ───────────
    const fast = parseReceiptText(fullText);
    const solid =
      bestConfidence >= 75 &&
      fast.total > 0 &&
      fast.date &&
      fast.vendor &&
      fast.items.length > 0;

    if (solid) {
      const rawText = formatRawText(fullText, winText, null);
      fast.confidence = Math.round(bestConfidence);
      return { extracted: fast, mode: 'ocr', engines, rawText, confidence: Math.round(bestConfidence) };
    }

    // ── Step 5: ensemble (handwritten / low confidence) ─
    console.log('  [AI] Running enhanced line-by-line analysis...');
    const lines = groupWordsIntoLines(words);

    // Ink bands (rows of ink) are the primary line regions: cursive handwriting
    // often produces no Tesseract word boxes at all. Word-box lines only fill
    // the gaps the bands miss.
    const bands = detectTextBands(binMain, w, h);
    const wordLines = lines
      .filter((l) => (l.words.map((x) => x.text).join('').match(/[A-Za-z0-9]/g) || []).length >= 3)
      .map((l) => ({ y0: l.y0, y1: l.y1 }));
    const regions = buildStripRegions(bands, wordLines, w, h);
    console.log(`  [AI] Text regions: ${bands.length} ink bands + ${regions.length - bands.length} word-box lines`);
    console.log(`    ${regions.map((r) => `${Math.round(r.y0)}-${Math.round(r.y1)}`).join(', ')}`);

    // Line strip re-OCR (multiple threshold variants; stop early when two agree)
    const lineReadings = [];
    for (const region of regions.slice(0, 18)) {
      const raw = [];
      for (const C of [10, 14, 18]) {
        if (raw.length >= 2 && raw[0] === raw[1]) break;
        raw.push(await ocrRegion(bins[C], w, h, region, PSM.SINGLE_LINE, 3));
      }
      // Faint cursive lines often need a lighter threshold (C=8), a stronger
      // upscale (×4) or extra vertical context (a padded crop) before
      // Tesseract can read them at all. Rescue bands whose readings carry no
      // 3-digit run — every date/total/amount line has one, so such bands are
      // either missed lines or junk; rescue is cheap for the latter and vital
      // for the former.
      if (!/\d{3,}/.test(raw.join(''))) {
        const words = raw.join(' ').split(/[^A-Za-z]+/).filter(Boolean);
        const maxWord = words.reduce((m, t) => Math.max(m, t.length), 0);
        if (raw.filter(Boolean).length === 0 || maxWord >= 4) {
          for (const resc of [
            { C: 8, up: 3, pad: 0 },
            { C: 6, up: 4, pad: 0 },
            { C: 18, up: 4, pad: 15 }
          ]) {
            if (/\d{3,}/.test(raw.join(''))) break;
            const region2 = resc.pad
              ? { ...region, y0: Math.max(0, region.y0 - resc.pad), y1: Math.min(h, region.y1 + resc.pad) }
              : region;
            const t = await ocrRegion(bins[resc.C], w, h, region2, PSM.SINGLE_LINE, resc.up);
            if (t) raw.push(t);
          }
        }
      }
      // A line with an amount but no word ≥4 letters carries no readable
      // item name ("Aid … 520" — "Milk" misread): lighter thresholds often
      // recover it, so run one more variant sweep for the name.
      if (/\d{3,}/.test(raw.join(''))) {
        const maxWord = () =>
          raw.join(' ').split(/[^A-Za-z]+/).filter(Boolean).reduce((m, t) => Math.max(m, t.length), 0);
        if (maxWord() < 4) {
          for (const resc of [
            { C: 8, up: 3, pad: 0 },
            { C: 6, up: 4, pad: 0 }
          ]) {
            if (maxWord() >= 4) break;
            const t = await ocrRegion(bins[resc.C], w, h, region, PSM.SINGLE_LINE, resc.up);
            if (t) raw.push(t);
          }
        }
      }
      const readings = [...new Set(raw.filter(Boolean))];
      if (readings.length) {
        lineReadings.push({ coreY0: region.coreY0, y: region.y0, y1: region.y1, readings });
      } else {
        console.log(`    y~${Math.round(region.coreY0)}-${Math.round(region.y1)}: (no text)`);
      }
    }
    console.log(`  [AI] Line analysis: ${lineReadings.length} text lines re-scanned`);
    for (const lr of lineReadings) {
      console.log(`    y~${Math.round(lr.coreY0)}: ${lr.readings.map((r) => `"${r.slice(0, 60)}"`).join(' | ')}`);
    }

    // Vendor region: above the topmost labeled line (fallback: top 18%)
    const labeledYs = [];
    for (const lr of lineReadings) {
      if (lr.readings.some((r) => matchLabel(r))) labeledYs.push(lr.coreY0);
    }
    const vendorBottom = labeledYs.length ? Math.max(40, Math.min(...labeledYs) - 8) : Math.floor(h * 0.18);
    const vendorRegion = { x0: 0, x1: w, y0: 0, y1: vendorBottom };
    const vendorReadings = [];
    for (const C of [14, 10, 8, 18]) {
      const txt = await ocrRegion(bins[C], w, h, vendorRegion, PSM.SINGLE_BLOCK, 3);
      if (txt && !vendorReadings.some((v) => v.text === txt)) vendorReadings.push({ text: txt, y: null, src: 'region' });
    }
    // Band readings inside the vendor region are position-anchored vendors
    for (const lr of lineReadings) {
      if (lr.coreY0 < vendorBottom) {
        for (const r of lr.readings) {
          if (!vendorReadings.some((v) => v.text === r)) vendorReadings.push({ text: r, y: lr.coreY0, src: 'band' });
        }
      }
    }
    console.log(`  [AI] Vendor readings (region 0-${Math.round(vendorBottom)}):`);
    for (const v of vendorReadings) {
      console.log(`    [${v.src}${v.y !== null ? '@' + Math.round(v.y) : ''}] "${v.text.slice(0, 70)}"`);
    }

    const ensemble = parseReceiptEnsemble({
      fullText,
      winText,
      lineReadings,
      vendorReadings,
      vendorBottom,
      fast,
      fastConfidence: bestConfidence
    });

    const rawText = formatRawText(fullText, winText, lineReadings);
    return {
      extracted: ensemble,
      mode: 'ocr',
      engines,
      rawText,
      confidence: ensemble.confidence
    };
  } catch (err) {
    console.error('[AI Service] Extraction failed:', err.message);
    console.error(err.stack);
    const friendly = new Error(
      'Failed to read the receipt image. The image may be too blurry or low quality. Please try a clearer, well-lit photo.'
    );
    friendly.rawText = rawTextSoFar;
    throw friendly;
  } finally {
    for (const f of tempFiles) fs.unlink(f, () => {});
  }
}

// ══════════════════════════════════════════════════════════
// STEP 1: IMAGE PREPROCESSING
// ══════════════════════════════════════════════════════════

/** Load, resize to OCR-friendly size, grayscale, contrast-normalize. */
async function loadAndPreprocess(inputPath) {
  const image = await Jimp.read(inputPath); // EXIF orientation applied on read
  const { width: origW, height: origH } = image.bitmap;

  const TARGET_H = 1600;
  let w = origW;
  let h = origH;
  if (h !== TARGET_H) {
    const scale = TARGET_H / h;
    w = Math.round(origW * scale);
    h = TARGET_H;
    image.resize(w, h);
  }
  image.grayscale();

  let { data, width: W, height: H } = image.bitmap;
  let gray = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = data[i];
  normalizeContrast(gray);

  // Trim desk/table background around the paper: tighten to the ink bbox
  // when it covers only part of the photo (conservative — never crops a
  // full-bleed page, never trusts a degenerate bbox).
  const cropped = autocropInk(gray, W, H);
  gray = cropped.gray;
  W = cropped.w;
  H = cropped.h;
  return { gray, w: W, h: H };
}

/**
 * Tighten the grayscale image to the ink bounding box. Only crops when the
 * bbox covers a sane fraction of the photo (5%–88%); otherwise keeps all.
 */
function autocropInk(gray, w, h) {
  const T = 90; // dark enough to be ink after contrast normalization
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (gray[row + x] < T) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { gray, w, h }; // blank page
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (area > 0.88 * w * h || area < 0.05 * w * h) return { gray, w, h };
  const mx = Math.max(20, Math.round(w * 0.025));
  const my = Math.max(20, Math.round(h * 0.025));
  x0 = Math.max(0, x0 - mx);
  x1 = Math.min(w - 1, x1 + mx);
  y0 = Math.max(0, y0 - my);
  y1 = Math.min(h - 1, y1 + my);
  const nw = x1 - x0 + 1;
  const nh = y1 - y0 + 1;
  const out = new Uint8Array(nw * nh);
  for (let y = y0; y <= y1; y++) {
    out.set(gray.subarray(y * w + x0, y * w + x1 + 1), (y - y0) * nw);
  }
  return { gray: out, w: nw, h: nh };
}

/** Rotate a grayscale buffer by 90/180/270 degrees clockwise. */
function rotateGray(gray, w, h, angle) {
  const out = new Uint8Array(gray.length);
  if (angle === 180) {
    for (let i = 0; i < gray.length; i++) out[gray.length - 1 - i] = gray[i];
    return { gray: out, w, h };
  }
  const nw = h;
  const nh = w;
  if (angle === 90) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[x * nw + (h - 1 - y)] = gray[y * w + x];
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[(w - 1 - x) * nw + y] = gray[y * w + x];
    }
  }
  return { gray: out, w: nw, h: nh };
}

/**
 * Remove isolated single-pixel salt noise from phone photos. Strictly
 * 1-px components: at this resolution every real glyph stroke (even a
 * period) is ≥ 2x2 px, and tests showed removing larger fragments perturbs
 * the OCR of faint cursive strokes.
 */
function despeckle(bin, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bin[i]) continue;
      let dark = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          if (bin[ny * w + nx]) dark++;
        }
      }
      if (dark === 0) bin[i] = 0; // completely isolated pixel = noise
    }
  }
}

/** Stretch the histogram so the darkest 1% → 0 and brightest 1% → 255. */
function normalizeContrast(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const cut = Math.floor(gray.length * 0.01);
  let lo = 0, acc = 0;
  while (lo < 255 && acc < cut) { acc += hist[lo]; lo++; }
  let hi = 255; acc = 0;
  while (hi > 0 && acc < cut) { acc += hist[hi]; hi--; }
  if (hi - lo < 10) return;
  const scale = 255 / (hi - lo);
  for (let i = 0; i < gray.length; i++) {
    let v = (gray[i] - lo) * scale;
    gray[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
}

/** Adaptive (local mean) thresholding using an integral image. */
function adaptiveThreshold(gray, w, h, win, C) {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const r = Math.floor(win / 2);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const count = (y1 - y0 + 1) * (x1 - x0 + 1);
      const sum =
        integral[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integral[y0 * (w + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0];
      out[y * w + x] = gray[y * w + x] <= sum / count - C ? 1 : 0;
    }
  }
  return out;
}

/** Remove horizontal ruling lines (notebook paper). */
function removeHorizontalRuling(bin, w, h) {
  const rowDark = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    let dark = 0;
    for (let x = 0; x < w; x++) if (bin[y * w + x]) dark++;
    rowDark[y] = dark;
  }
  let y = 0;
  while (y < h) {
    if (rowDark[y] / w > 0.45) {
      let bandEnd = y;
      while (bandEnd < h && rowDark[bandEnd] / w > 0.35) bandEnd++;
      if (bandEnd - y <= 5) {
        for (let yy = y; yy < bandEnd; yy++) for (let x = 0; x < w; x++) bin[yy * w + x] = 0;
      }
      y = bandEnd;
    } else y++;
  }
}

/** Remove vertical ruling/margin lines (notebook margin, paper folds). */
function removeVerticalRuling(bin, w, h) {
  const colDark = new Uint32Array(w);
  for (let x = 0; x < w; x++) {
    let dark = 0;
    for (let y = 0; y < h; y++) if (bin[y * w + x]) dark++;
    colDark[x] = dark;
  }
  let x = 0;
  while (x < w) {
    if (colDark[x] / h > 0.35) {
      let bandEnd = x;
      while (bandEnd < w && colDark[bandEnd] / h > 0.25) bandEnd++;
      if (bandEnd - x <= 5) {
        for (let xx = x; xx < bandEnd; xx++) for (let y = 0; y < h; y++) bin[y * w + xx] = 0;
      }
      x = bandEnd;
    } else x++;
  }
}

/** Write a binary (0/1) mask as a black-and-white PNG temp file. */
async function writeBinaryImage(bin, w, h) {
  const img = await Jimp.create(w, h);
  img.scan(0, 0, w, h, function (x, y, idx) {
    const v = bin[y * w + x] ? 0x00 : 0xff;
    this.bitmap.data[idx] = v;
    this.bitmap.data[idx + 1] = v;
    this.bitmap.data[idx + 2] = v;
    this.bitmap.data[idx + 3] = 0xff;
  });
  const out = path.join(os.tmpdir(), `ks-bin-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await img.writeAsync(out);
  return out;
}

/** Prepare the input Windows OCR likes best: 2x upscaled grayscale + contrast. */
async function writeWindowsInput(inputPath) {
  const image = await Jimp.read(inputPath);
  const { width: ow, height: oh } = image.bitmap;
  const s = 3200 / Math.max(ow, oh);
  image.resize(Math.round(ow * Math.min(s, 2.5)), Math.round(oh * Math.min(s, 2.5)));
  image.grayscale().contrast(0.2);
  const out = path.join(os.tmpdir(), `ks-win-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await image.writeAsync(out);
  return out;
}

// ══════════════════════════════════════════════════════════
// STEP 2: OCR ENGINES
// ══════════════════════════════════════════════════════════

let workerPromise = null;
let tessVersionLogged = false;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1).then((worker) => {
      if (!tessVersionLogged) {
        tessVersionLogged = true;
        let v = 'unknown';
        try {
          v = JSON.parse(fs.readFileSync(path.join(__dirname, '../node_modules/tesseract.js/package.json'), 'utf8')).version;
        } catch { /* version is diagnostic only */ }
        console.log(`  [AI] Tesseract.js worker ready (v${v}, lang=eng, oem=LSTM)`);
      }
      return worker;
    });
  }
  return workerPromise;
}

/** One OCR pass → { text, confidence, words[] } (words include bounding boxes). */
async function runOcrPass(imagePath, psm) {
  const worker = await getWorker();
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: '1'
  });
  const { data } = await worker.recognize(imagePath);
  return { text: data.text || '', confidence: data.confidence || 0, words: extractWords(data) };
}

function extractWords(data) {
  const words = [];
  try {
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const word of line.words || []) {
            if (word.text && word.text.trim() && (word.confidence || 0) > 30) {
              words.push({ text: word.text.trim(), bbox: word.bbox, conf: word.confidence });
            }
          }
        }
      }
    }
  } catch (e) { /* tolerate malformed result trees */ }
  return words;
}

function scoreOcr(text, confidence) {
  const meaningful = (text.match(/[A-Za-z0-9]/g) || []).length;
  return meaningful * Math.max(confidence, 1);
}

/** Windows native OCR (handwriting-capable) via PowerShell bridge. */
async function runWindowsOcr(imagePath) {
  if (process.platform !== 'win32') return null;
  const script = path.join(__dirname, 'winocr.ps1');
  if (!fs.existsSync(script)) return null;
  const { stdout } = await execFileP(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', imagePath],
    { timeout: 45000, windowsHide: true }
  );
  const m = stdout.match(/---TEXT START---([\s\S]*?)---TEXT END---/);
  if (!m) {
    console.log(`  [AI] Windows OCR: unexpected stdout: ${stdout.slice(0, 120).replace(/\s+/g, ' ')}`);
    return null;
  }
  return { text: m[1].trim() };
}

// ══════════════════════════════════════════════════════════
// STEP 3: LINE DETECTION + STRIP RE-OCR
// ══════════════════════════════════════════════════════════

/** Group word boxes into visual lines (y-overlap clustering). */
function groupWordsIntoLines(words) {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const lines = [];
  for (const wd of sorted) {
    const line = lines.find((l) => {
      const ov = Math.min(l.y1, wd.bbox.y1) - Math.max(l.y0, wd.bbox.y0);
      const minH = Math.min(l.y1 - l.y0, wd.bbox.y1 - wd.bbox.y0);
      return minH > 0 && ov > minH * 0.4;
    });
    if (line) {
      line.words.push(wd);
      line.y0 = Math.min(line.y0, wd.bbox.y0);
      line.y1 = Math.max(line.y1, wd.bbox.y1);
      line.x0 = Math.min(line.x0, wd.bbox.x0);
      line.x1 = Math.max(line.x1, wd.bbox.x1);
    } else {
      lines.push({ y0: wd.bbox.y0, y1: wd.bbox.y1, x0: wd.bbox.x0, x1: wd.bbox.x1, words: [wd] });
    }
  }
  return lines.filter((l) => l.y1 - l.y0 >= 8).sort((a, b) => a.y0 - b.y0);
}

/**
 * Build the list of strip regions to re-OCR. Ink bands are primary (tight,
 * single-line); word-box lines fill gaps the bands miss (±18px padding).
 * Consecutive regions are clamped so no strip bleeds into its neighbour.
 */
function buildStripRegions(bands, wordLines, w, h) {
  const regions = [...bands];
  for (const wl of wordLines) {
    // fraction of the word line covered by the union of bands
    const marks = new Uint8Array(h);
    for (const b of bands) {
      for (let y = Math.max(b.y0, wl.y0); y < Math.min(b.y1, wl.y1); y++) marks[y] = 1;
    }
    let covered = 0;
    for (let y = wl.y0; y < wl.y1; y++) covered += marks[y];
    if ((wl.y1 - wl.y0) > 0 && covered / (wl.y1 - wl.y0) < 0.8) {
      regions.push({ x0: 0, x1: w, y0: Math.max(0, wl.y0 - 18), y1: Math.min(h, wl.y1 + 18), coreY0: wl.y0 });
    }
  }
  regions.sort((a, b) => a.y0 - b.y0);
  for (let i = 0; i < regions.length - 1; i++) {
    if (regions[i].y1 > regions[i + 1].y0 - 2) {
      const newY1 = regions[i + 1].y0 - 2;
      if (newY1 - regions[i].y0 >= 12) regions[i].y1 = newY1;
      else regions[i + 1].y0 = regions[i].y1 + 2;
    }
  }
  return regions.filter((r) => r.y1 - r.y0 >= 12);
}

/**
 * Detect text bands from the ink-density row profile of the binarized image.
 * Cursive handwriting often yields no Tesseract word boxes at all, so we look
 * for rows of ink directly (with hysteresis so gaps within a line don't split).
 * Bands taller than one text line are split at their shallowest interior row.
 */
function detectTextBands(bin, w, h) {
  const dark = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    let d = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) d += bin[row + x];
    dark[y] = d;
  }
  // Smooth (window 7) to bridge gaps between words on the same line
  const S = 7;
  const sm = new Float32Array(h);
  let acc = 0;
  for (let y = 0; y < h; y++) {
    acc += dark[y];
    if (y >= S) acc -= dark[y - S];
    sm[y] = acc / Math.min(y + 1, S);
  }
  // Background noise ≈ a low percentile row (the median is useless on
  // text-dense receipts where most rows carry ink); text rows sit far above.
  const sorted = Float32Array.from(sm).sort();
  const p25 = sorted[Math.floor(h * 0.25)] || 0;
  const enter = Math.max(70, p25 * 2.5);
  const exit = enter * 0.75;

  const bands = [];
  let y = 0;
  while (y < h) {
    if (sm[y] > enter) {
      let y1 = y;
      while (y1 < h && sm[y1] > exit) y1++;
      const height = y1 - y;
      if (height >= 25 && height <= 400) bands.push({ x0: 0, x1: w, y0: y, y1, coreY0: y });
      y = y1;
    } else y++;
  }
  return bands.flatMap((b) => splitBand(b, sm, 130)).filter((b) => b.y1 - b.y0 >= 18);
}

/** Recursively split a band taller than maxH at its shallowest interior row. */
function splitBand(band, sm, maxH) {
  const height = band.y1 - band.y0;
  if (height <= maxH) return [band];
  const m = Math.max(8, Math.floor(height * 0.08));
  let peakV = 0;
  for (let y = band.y0; y < band.y1; y++) peakV = Math.max(peakV, sm[y]);
  let minY = -1;
  let minV = Infinity;
  for (let y = band.y0 + m; y < band.y1 - m; y++) {
    if (sm[y] < minV) {
      minV = sm[y];
      minY = y;
    }
  }
  if (minY < 0 || peakV === 0 || minV > peakV * 0.55) return [band];
  return [
    ...splitBand({ x0: band.x0, x1: band.x1, y0: band.y0, y1: minY, coreY0: band.y0 }, sm, maxH),
    ...splitBand({ x0: band.x0, x1: band.x1, y0: minY, y1: band.y1, coreY0: minY }, sm, maxH)
  ].filter((b) => b.y1 - b.y0 >= 18);
}

/**
 * Crop a region from a binary mask, upscale, add a white border, and OCR it.
 * Writes a temp file (Tesseract needs a file) and removes it afterwards.
 */
async function ocrRegion(bin, w, h, region, psm, upscale) {
  const x0 = Math.max(0, Math.floor(region.x0));
  const x1 = Math.min(w, Math.ceil(region.x1));
  const y0 = Math.max(0, Math.floor(region.y0));
  const y1 = Math.min(h, Math.ceil(region.y1));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw < 20 || ch < 12) return '';

  const crop = await Jimp.create(cw, ch);
  crop.scan(0, 0, cw, ch, function (cx, cy, idx) {
    const v = bin[(y0 + cy) * w + (x0 + cx)] ? 0x00 : 0xff;
    this.bitmap.data[idx] = v;
    this.bitmap.data[idx + 1] = v;
    this.bitmap.data[idx + 2] = v;
    this.bitmap.data[idx + 3] = 0xff;
  });
  crop.resize(cw * upscale, ch * upscale);

  const bw = cw * upscale + 40;
  const bh = ch * upscale + 40;
  const bordered = await new Jimp(bw, bh, '#ffffff');
  bordered.composite(crop, 20, 20);

  const file = path.join(os.tmpdir(), `ks-strip-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    await bordered.writeAsync(file);
    const worker = await getWorker();
    await worker.setParameters({
      tessedit_pageseg_mode: String(psm),
      preserve_interword_spaces: '1'
    });
    const { data } = await worker.recognize(file);
    return (data.text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  } finally {
    fs.unlink(file, () => {});
  }
}

// ══════════════════════════════════════════════════════════
// STEP 4: ENSEMBLE PARSER (handwritten / low-confidence path)
// ══════════════════════════════════════════════════════════

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NUM = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** OCR letter→digit confusions seen in handwritten years ("n0de" → 2026). */
const DIGIT_CONFUSION = { n: '2', r: '2', z: '2', l: '1', i: '1', '|': '1', o: '0', d: '2', q: '0', e: '6', b: '6', g: '6', '¥': '6', s: '5', t: '7', h: '4', a: '4', j: '7' };

/** Receipt field labels with fuzzy-match synonyms. */
const LABELS = {
  date: ['date', 'dt', 'tareekh', 'tarik', 'tareeq'],
  item: ['item', 'items', 'description', 'desc', 'product', 'details', 'particulars'],
  qty: ['qty', 'quantity', 'qnty', 'count'],
  amount: ['amount', 'amt', 'price', 'rakam', 'rupay', 'rupees', 'rupya'],
  total: ['total', 'subtotal', 'grand total', 'net total', 'bill amount', 'bill', 'net', 'kul', 'kul raqam', 'jama', 'raqam', 'total due', 'amount due', 'balance due', 'amount payable'],
  payment: ['payment', 'paid', 'method', 'mode', 'naqad', 'udhaar', 'udhar'],
  vendor: ['vendor', 'merchant', 'shop', 'seller', 'dukan', 'dukaan', 'dukandaar'],
  invoice: ['invoice', 'receipt', 'number', 'ref'],
  discount: ['discount'],
  change: ['change']
};

/** Common words in Pakistani shop names (for vendor correction). */
const STORE_WORDS = ['general', 'store', 'super', 'market', 'mart', 'shop', 'kirana', 'grocery', 'provision', 'bakery', 'bakers', 'sweets', 'pharmacy', 'medical', 'electronics', 'mobile', 'clothes', 'boutique', 'traders', 'trading', 'company', 'enterprises', 'depot', 'cash', 'carry', 'bazaar', 'hyper', 'fresh', 'vegetables', 'fruits', 'hardware', 'petrol', 'filling', 'station', 'karyana'];

/** Tokens that are receipt labels/months, never part of a shop name. */
const NON_VENDOR_WORDS = new Set([
  'date', 'dt', 'tareekh', 'tarik', 'tareeq', 'item', 'items', 'description', 'desc', 'product', 'details', 'particulars',
  'qty', 'quantity', 'qnty', 'count', 'amount', 'amt', 'price', 'rakam', 'total', 'subtotal', 'bill',
  'net', 'kul', 'jama', 'raqam', 'payment', 'paid', 'method', 'mode', 'naqad', 'udhaar', 'udhar', 'invoice', 'receipt', 'number', 'ref',
  'discount', 'change', 'vendor', 'merchant', 'seller', 'dukan', 'dukaan', 'dukandaar', 'the', 'and',
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
]);

// ── Transaction type classification ─────────────────────
// The type is classified ONLY on explicit textual evidence. A vendor name,
// an item list, a total, or a payment method proves neither a sale nor an
// expense — in that case the type stays 'ambiguous' and the user must
// choose Sale or Expense on the review screen before saving.
const SALE_TYPE_RE = /\b(sale|sold|sales|sales?\s+receipt|income|received|amount\s+received|payment\s+received|customer\s+(?:purchase|invoice)|invoice\s+to\s+customer|bikri|becha|bechi|maal\s*becha|aaj\s*ki\s*(?:sale|bikri))\b/i;
const EXPENSE_TYPE_RE = /\b(purchase|purchases|purchased|bought|buy|supplier|supplier'?s?\s+(?:bill|invoice)|vendor\s+bill|business\s+expense|expenses?|kharcha|kharch|khareeda|khareed|maal\s*(?:liya|khareeda)|supplier\s*se\s*liya)\b/i;
function classifyTransactionType(text) {
  if (SALE_TYPE_RE.test(text)) return 'sale';
  if (EXPENSE_TYPE_RE.test(text)) return 'expense';
  return 'ambiguous';
}

function parseReceiptEnsemble({ fullText, winText, lineReadings, vendorReadings, vendorBottom, fast, fastConfidence }) {
  const result = {
    date: '',
    type: 'ambiguous',
    category: '',
    vendor: '',
    description: '',
    items: [],
    total: 0,
    paymentMethod: '',
    lowConfidenceFields: []
  };

  const allReadings = [
    fullText,
    winText || '',
    ...lineReadings.flatMap((l) => l.readings),
    ...vendorReadings.map((v) => v.text)
  ].filter(Boolean);

  // ── Labeled lines (fuzzy label match on every reading) ──
  const labeled = [];
  for (const lr of lineReadings) {
    const lineLabels = new Set();
    for (const r of lr.readings) {
      const m = matchLabel(r);
      if (m) {
        if (!plausibleLabel(m.label, m.value)) continue;
        labeled.push({ ...m, y: lr.y });
        lineLabels.add(m.label);
      }
    }
    // Sibling readings of the same line share its label even when their own
    // label word is mangled beyond matchLabel's tolerance (e.g. "Dede:" next
    // to a readable "Dae:"). Strip the leading label-ish token and inherit.
    for (const label of lineLabels) {
      for (const r of lr.readings) {
        if (matchLabel(r)) continue;
        const stripped = stripLeadingLabel(r, label);
        if (stripped) labeled.push({ label, value: stripped, y: lr.y });
      }
    }
  }
  for (const src of [fullText, winText || '']) {
    for (const line of src.split('\n')) {
      const m = matchLabel(line.trim());
      if (m && plausibleLabel(m.label, m.value)) labeled.push({ ...m, y: 1000000 });
    }
  }
  console.log(`  [AI] Labeled lines: ${labeled.map((l) => `${l.label}="${l.value.slice(0, 30)}"@${Math.round(l.y)}`).join(' | ') || '(none)'}`);

  // ── Date (vote across readings) ──────────────────────
  const dateValues = labeled.filter((l) => l.label === 'date').map((l) => l.value);
  if (fast.date) dateValues.push(fast.date);
  // Dates also hide in readings whose label was mangled beyond recognition
  // ("Moke: 0d Sep 02") — any reading containing a month name and at least
  // one digit is a date candidate too.
  for (const r of allReadings) {
    for (const line of r.split('\n')) {
      if (!/\d/.test(line)) continue;
      const hasMonth = line.split(/[\s,]+/).some((t) => findMonthInToken(t.replace(/[^\w¥|]/g, '')));
      if (hasMonth && !dateValues.includes(line.trim())) dateValues.push(line.trim());
    }
  }
  const dateOut = parseDateEnsemble(dateValues);
  if (dateOut.date) {
    result.date = dateOut.date;
    if (dateOut.lowConfidence) result.lowConfidenceFields.push('date');
  } else {
    result.lowConfidenceFields.push('date');
  }

  // ── Total (label match → keywords → item-sum confirmation) ──
  const lineAmounts = collectLineAmounts(lineReadings, labeled);
  const totalOut = extractTotalEnsemble(labeled, allReadings, fast, lineAmounts);
  result.total = totalOut.value;
  if (!totalOut.value || totalOut.lowConfidence) result.lowConfidenceFields.push('total');

  // ── Vendor (token clustering across readings) ────────
  result.vendor = assembleVendor(vendorReadings, winText);
  if (!result.vendor) result.lowConfidenceFields.push('vendor');

  // ── Payment method ───────────────────────────────────
  const payLabeled = labeled.filter((l) => l.label === 'payment').map((l) => l.value);
  result.paymentMethod = extractPaymentEnsemble(payLabeled, allReadings);
  if (!result.paymentMethod) result.lowConfidenceFields.push('payment');

  // ── Items / description ──────────────────────────────
  const itemLabeled = labeled.find((l) => l.label === 'item');
  const qtyLabeled = labeled.find((l) => l.label === 'qty');

  if (fast.items.length >= 2 && totalOut.value > 0) {
    // Printed receipt structure: keep item lines when their sum is close to the total
    const sum = fast.items.reduce((s, i) => s + (i.qty || 1) * i.price, 0);
    if (Math.abs(sum - totalOut.value) / totalOut.value < 0.35) result.items = fast.items;
  }
  if (result.items.length === 0) {
    // Handwritten item lines: an unlabeled line with a name and a price
    const parsed = parseItemLines(lineReadings, lineAmounts, totalOut, labeled, fullText, vendorBottom);
    result.items = parsed.items;
    // A line whose name no reading could confirm (cursive neither engine
    // reads) is kept with its price but flagged — never silently saved as
    // a confidently wrong name.
    if (parsed.items.length > 0 && parsed.nameUnconfirmed) result.lowConfidenceFields.push('items');
  }
  if (result.items.length === 0 && itemLabeled) {
    const name = cleanText(itemLabeled.value);
    if (name && /[A-Za-z]{3,}/.test(name)) {
      const qty = qtyLabeled ? parseQty(qtyLabeled.value) : 1;
      result.items = [{ name, qty, price: totalOut.value || 0 }];
    }
  }
  if (result.items.length === 0) result.lowConfidenceFields.push('items');

  if (result.items.length > 0) {
    result.description = result.items.map((i) => i.name).filter(Boolean).slice(0, 3).join(', ');
  } else if (itemLabeled && cleanText(itemLabeled.value)) {
    result.description = cleanText(itemLabeled.value);
  } else {
    result.lowConfidenceFields.push('description');
  }

  // ── Category + type ──────────────────────────────────
  const combinedText = allReadings.join(' \n ') + ' ' + result.vendor + ' ' + result.description;
  result.category = inferCategory(combinedText, result.vendor);
  result.type = classifyTransactionType(combinedText);

  // ── Confidence ───────────────────────────────────────
  // Honest reporting: low-confidence fields get a lower score contribution
  // so the overall confidence reflects extraction quality, not just field presence.
  const confidences = [fastConfidence || 0];
  if (totalOut.value) {
    confidences.push(result.lowConfidenceFields.includes('total')
      ? Math.min(45, 30 + totalOut.votes * 3)
      : Math.min(88, 55 + totalOut.votes * 6));
  }
  if (dateOut.date) {
    confidences.push(result.lowConfidenceFields.includes('date')
      ? 40
      : (dateOut.lowConfidence ? 60 : Math.min(85, 55 + dateOut.votes * 6)));
  }
  if (result.vendor) {
    confidences.push(result.lowConfidenceFields.includes('vendor') ? 40 : 72);
  }
  const avgConf = confidences.reduce((s, c) => s + c, 0) / confidences.length;
  const anythingRead = result.total > 0 || result.date || result.vendor || result.items.length > 0;
  let finalConf = Math.round(anythingRead ? Math.max(40, avgConf) : Math.min(25, avgConf));
  // Penalize heavily when 3+ critical fields are flagged low-confidence
  const criticalFlags = ['total', 'vendor', 'date', 'items']
    .filter(f => result.lowConfidenceFields.includes(f)).length;
  if (criticalFlags >= 3) finalConf = Math.min(finalConf, 35);
  else if (criticalFlags >= 2) finalConf = Math.min(finalConf, 45);
  result.confidence = finalConf;

  // Total-vs-items validation: if the extracted total disagrees with the
  // item sum by more than 30%, the total is likely wrong (e.g. OCR read an
  // item amount instead of the actual total). Flag for user review.
  if (result.total > 0 && result.items.length > 0) {
    const itemSum = result.items.reduce((s, i) => s + (i.qty || 1) * i.price, 0);
    if (itemSum > 0 && Math.abs(itemSum - result.total) > result.total * 0.3) {
      if (!result.lowConfidenceFields.includes('total')) result.lowConfidenceFields.push('total');
    }
  }
  result.lowConfidenceFields = [...new Set(result.lowConfidenceFields)];
  return result;
}

// ── Fuzzy label matching ───────────────────────────────

/** Match "Date: ...", "Nate ...", "Panmebi Cosh" style lines to known labels. */
function matchLabel(text) {
  if (!text) return null;
  const cleaned = text.replace(/[|_~^"']+/g, ' ').trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(/\s+/).slice(0, 4);
  for (let i = 0; i < Math.min(3, tokens.length); i++) {
    const tok = tokens[i].toLowerCase().replace(/[^a-z]/g, '');
    if (tok.length < 2) continue;
    const tok2 = (tokens[i + 1] || '').toLowerCase().replace(/[^a-z]/g, '');
    // Collect every label word matching at this position; the most specific
    // (longest) wins, so "Amount Due:" is a total, not a generic amount.
    let best = null;
    for (const [label, words] of Object.entries(LABELS)) {
      for (const word of words) {
        let value = null;
        if (word.includes(' ')) {
          const [w1, w2] = word.split(' ');
          if (tok === w1 && tok2 === w2) value = tokens.slice(i + 2).join(' ');
        } else {
          const tol = word.length <= 3 ? 0 : word.length <= 5 ? 1 : word.length <= 6 ? 2 : 3;
          if (tok === word || levenshtein(tok, word) <= tol) value = tokens.slice(i + 1).join(' ');
        }
        if (value === null) continue;
        value = value.replace(/^[\s:\-–.]+/, '').trim();
        if (value.length === 0) continue;
        if (!best || word.length > best.word.length) best = { label, value, word };
      }
    }
    if (best) return { label: best.label, value: best.value };
  }
  return null;
}

/**
 * Remove the leading label-ish token from a sibling reading of a line whose
 * label was matched by another variant ("“Dede: al Augn0d¥e" + label "date"
 * → "al Augn0d¥e"). Returns null when the first token does not resemble the
 * label — it may be part of the value.
 */
function stripLeadingLabel(text, label) {
  const m = (text || '').match(/^\s*([^\s]+)\s+(.+)$/);
  if (!m) return null;
  const first = m[1].toLowerCase().replace(/[^a-z]/g, '');
  if (first.length < 2) return null;
  for (const w of LABELS[label] || []) {
    const tol = Math.max(2, Math.floor(w.length * 0.5));
    if (levenshtein(first, w) <= tol) return m[2].replace(/^[\s:\-–.]+/, '').trim();
  }
  return null;
}

/**
 * A fuzzy label match must still be plausible: a line labeled "payment"
 * whose value is a bare currency amount ("Aid" → "Paid", value "… Rs. 520")
 * is an item line misread as a label — accepting it would steal the line
 * from the item sums.
 */
function plausibleLabel(label, value) {
  if (label !== 'payment') return true;
  if (!extractAmountsLoose(value).some((v) => v >= 100)) return true;
  const tokens = (value || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return tokens.some((tok) => {
    if (PAYMENT_CASH_MANGLES.has(tok)) return true;
    return PAYMENT_WORDS.some(([w]) => tok === w || levenshtein(tok, w) <= (w.length <= 4 ? 1 : Math.floor(w.length * 0.25)));
  });
}

// ── Date ensemble ──────────────────────────────────

/** Parse every reading, vote on day/month/year, return {date, votes, lowConfidence}. */
function parseDateEnsemble(values) {
  const dayVotes = {};
  const monthVotes = {};
  const yearVotes = {};
  const fullVotes = {};
  let parsedCount = 0;

  for (const v of values) {
    const p = parseDateParts(v);
    if (!p) continue;
    parsedCount++;
    if (p.day) dayVotes[p.day] = (dayVotes[p.day] || 0) + (p.dayWeight || 1);
    if (p.month) monthVotes[p.month] = (monthVotes[p.month] || 0) + 1;
    if (p.year) yearVotes[p.year] = (yearVotes[p.year] || 0) + (p.yearWeight || 1);
    if (p.day && p.month && p.year) {
      const iso = `${p.year}-${MONTH_NUM[p.month]}-${String(p.day).padStart(2, '0')}`;
      fullVotes[iso] = (fullVotes[iso] || 0) + 1;
    }
  }

  if (parsedCount === 0) return { date: '', votes: 0 };

  // A complete date agreed on repeatedly wins outright
  const fullEntries = Object.entries(fullVotes).sort((a, b) => b[1] - a[1]);
  if (fullEntries.length && fullEntries[0][1] >= 2) {
    return { date: fullEntries[0][0], votes: fullEntries[0][1], lowConfidence: false };
  }

  // Otherwise assemble from the majority of each component
  const best = (votes) => Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || null;
  const day = best(dayVotes);
  const month = best(monthVotes);
  const year = best(yearVotes);
  if (day && month && year) {
    const d = parseInt(day[0], 10);
    const y = parseInt(year[0], 10);
    if (d >= 1 && d <= 31 && y >= 1990 && y <= 2099) {
      return {
        date: `${y}-${MONTH_NUM[month[0]]}-${String(d).padStart(2, '0')}`,
        votes: Math.min(day[1], month[1], year[1]),
        lowConfidence: true
      };
    }
  }
  if (fullEntries.length) return { date: fullEntries[0][0], votes: 1, lowConfidence: true };
  return { date: '', votes: 0 };
}

/**
 * Parse one date reading into parts. Handles merged handwriting like
 * "31 kugn0de" (31 Aug 2026), "3l Augn0¥", "3 Aug202" and numeric formats.
 */
function parseDateParts(value) {
  if (!value) return null;
  const v = fixOcrDigits(value);
  const tokens = v.split(/[\s,]+/).filter(Boolean);

  let day = null;
  let month = null;
  let year = null;
  let monthSeen = false;
  let dayWeight = 1;
  let yearWeight = 1;

  for (const rawTok of tokens) {
    const tok = rawTok.replace(/[^\w¥|]/g, '');
    if (!tok) continue;

    const m = findMonthInToken(tok);
    if (m) {
      month = m.month;
      monthSeen = true;
      const y = parseYearToken(tok.slice(m.end));
      if (y) {
        year = y;
        yearWeight = tok.slice(m.end).length >= 4 ? 2 : 1;
      }
      continue;
    }
    if (/^\d{1,4}$/.test(tok)) {
      const n = parseInt(tok, 10);
      if (!monthSeen) {
        if (n >= 1 && n <= 31 && !day) {
          day = n;
          // Longer digit runs are more trustworthy — single digits are often
          // truncated handwriting ("31" misread as "3").
          dayWeight = tok.length + 1;
        }
      } else {
        const y = parseYearToken(tok);
        if (y) {
          year = y;
          yearWeight = tok.length >= 4 ? 2 : 1;
        }
      }
    } else if (!monthSeen && !day) {
      // Cursive day digits often read as letters ("31" → "al"); try to
      // recover the day from confusion-letter interpretations.
      const amb = dayFromAmbiguousToken(tok);
      if (amb) {
        day = amb.day;
        dayWeight = amb.weight;
      }
    }
  }

  if (!day && !month && !year) {
    const numeric = parseNumericDate(v);
    if (numeric) {
      const [y, mo, d] = numeric.split('-');
      return { day: parseInt(d, 10), month: MONTHS[parseInt(mo, 10) - 1], year: parseInt(y, 10), dayWeight: 2, yearWeight: 2 };
    }
    return null;
  }
  if (day || month || year) return { day, month, year, dayWeight, yearWeight };
  return null;
}

/**
 * Interpret a short token found in day position as digits using OCR
 * confusion letters — including tokens that mix digits and letters ("31" is
 * read as "al"; "02" as "0d"). Interpretations that do not form a valid
 * day (1-31) are discarded; ambiguity returns null.
 */
function dayFromAmbiguousToken(tok) {
  if (!/^[a-z¥|0-9]{1,3}$/i.test(tok)) return null;
  let candidates = [''];
  for (const ch of tok.toLowerCase()) {
    const alts = [];
    if (/[0-9]/.test(ch)) alts.push(ch);
    if (DIGIT_CONFUSION[ch] !== undefined) alts.push(DIGIT_CONFUSION[ch]);
    if (ch === 'a') alts.push('3'); // cursive '3' joined to the next digit
    if (alts.length === 0) return null;
    const next = [];
    for (const p of candidates) for (const d of alts) next.push(p + d);
    candidates = next;
  }
  const valid = [...new Set(candidates.map((c) => parseInt(c, 10)).filter((n) => n >= 1 && n <= 31))];
  if (valid.length !== 1) return null;
  // Digit-bearing tokens ("0d" → 02) are more trustworthy than pure-letter
  // junk ("og" → 06); weight accordingly so junk cannot outvote real days.
  return { day: valid[0], weight: tok.length + (/\d/.test(tok) ? 1 : 0) };
}

/** Find the best-matching month inside a token (whole word, or 3-letter window when digits are present). */
function findMonthInToken(tok) {
  const t = tok.toLowerCase().replace(/[^a-z]/g, '');
  if (t.length < 3) return null;
  const hasDigit = /\d/.test(tok);
  if (!hasDigit) {
    // whole word: exact, 3-letter prefix, or ≤1 edit away — best match wins
    let best = null;
    for (const m of MONTHS) {
      if (t === m) return { month: m, end: tok.length };
      if (t.length >= 3 && t.length <= 9 && t.slice(0, 3) === m) return { month: m, end: tok.length };
      const d = levenshtein(t, m);
      if (d <= 1 && (!best || d < best.d)) best = { month: m, end: tok.length, d };
    }
    return best ? { month: best.month, end: best.end } : null;
  }
  // digits present: scan 3-letter windows, best match wins ("kugn0de" → aug,
  // not jun — lev(kug,aug)=1 beats lev(kug,jun)=2)
  let best = null;
  for (let i = 0; i + 3 <= t.length; i++) {
    const win = t.slice(i, i + 3);
    for (const m of MONTHS) {
      const d = levenshtein(win, m);
      if (d <= 1 && (!best || d < best.d || (d === best.d && i < best.i))) {
        best = { month: m, end: i + 3, d, i };
      }
    }
  }
  return best ? { month: best.month, end: best.end } : null;
}

/** Parse a year token, applying letter→digit confusion mapping for handwriting. */
function parseYearToken(s) {
  if (!s) return null;
  const t = s.replace(/[^\w¥|]/g, '');
  if (!t) return null;
  if (/^\d{4}$/.test(t)) {
    const y = parseInt(t, 10);
    return y >= 1990 && y <= 2099 ? y : null;
  }
  if (/^\d{2}$/.test(t)) {
    const y = 2000 + parseInt(t, 10);
    return y >= 2000 && y <= 2099 ? y : null;
  }
  const mapped = t
    .split('')
    .map((c) => (DIGIT_CONFUSION[c.toLowerCase()] !== undefined ? DIGIT_CONFUSION[c.toLowerCase()] : c))
    .join('');
  if (/^\d{4}$/.test(mapped)) {
    const y = parseInt(mapped, 10);
    return y >= 1990 && y <= 2099 ? y : null;
  }
  // 5-6 mapped digits: a trailing stroke often splits the last digit
  // (cursive "2026" → "n0d¥e" → "20266")
  if (/^\d{5,6}$/.test(mapped)) {
    for (const cand of [mapped.slice(0, 4), mapped.slice(-4)]) {
      const y = parseInt(cand, 10);
      if (y >= 1990 && y <= 2099) return y;
    }
  }
  if (/^\d{3}$/.test(t) || /^\d{3}$/.test(mapped)) {
    const three = /^\d{3}$/.test(t) ? t : mapped;
    if (three.startsWith('20')) {
      // 3-digit year: resolve to the nearest year of the current decade
      const current = new Date().getFullYear();
      const decadeStart = Math.floor(current / 10) * 10;
      const candidates = [decadeStart, decadeStart + 1, decadeStart + 2, decadeStart + 3, decadeStart + 4, decadeStart + 5, decadeStart + 6, decadeStart + 7, decadeStart + 8, decadeStart + 9];
      const prefix = parseInt(three.slice(0, 2), 10) * 10;
      const best = candidates.reduce((a, b) => (Math.abs(b - current) < Math.abs(a - current) ? b : a), prefix);
      return best;
    }
  }
  return null;
}

// ── Total ensemble ─────────────────────────────────────

/**
 * One consensus amount per line: the most frequent amount across the line's
 * readings (ties → larger). Lines without an amount are skipped. Date,
 * payment and total/invoice-labeled lines carry years and numbers that are
 * not prices — their trailing digits would poison the item-sum check, so
 * they are skipped too.
 */
function collectLineAmounts(lineReadings, labeled) {
  const skipYs = new Set(
    labeled
      .filter((l) => ['date', 'payment', 'total', 'invoice', 'change', 'discount'].includes(l.label))
      .map((l) => l.y)
  );
  const out = [];
  for (const lr of lineReadings) {
    if (skipYs.has(lr.y)) continue;
    if (lr.readings.some((r) => looksLikeDateLine(r))) continue;
    const votes = {};
    for (const r of lr.readings) {
      for (const a of extractAmountsLoose(r)) {
        if (a >= 100) votes[a] = (votes[a] || 0) + 1;
      }
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1] || parseFloat(b[0]) - parseFloat(a[0]))[0];
    if (best) out.push({ y: lr.y, value: parseFloat(best[0]) });
  }
  return out;
}

/** A reading containing a month name and a digit is a date line, whatever its label says. */
function looksLikeDateLine(text) {
  if (!text || !/\d/.test(text)) return false;
  return text.split(/[\s,]+/).some((t) => findMonthInToken(t.replace(/[^\w¥|]/g, '')));
}

function extractTotalEnsemble(labeled, allReadings, fast, lineAmounts) {
  // 1. Lines explicitly labeled total / amount due / payable
  const totalLabeled = labeled
    .filter((l) => l.label === 'total')
    .map((l) => firstAmountLoose(l.value))
    .filter((v) => v > 0);
  if (totalLabeled.length) {
    const [value, votes] = voteNumber(totalLabeled);
    return { value, votes, lowConfidence: false, totalY: null };
  }

  // 2. Explicit "total / amount due" keyword patterns anywhere
  for (const src of allReadings) {
    const kw = findTotalLine(src.split('\n'));
    if (kw) return { value: kw, votes: 1, lowConfidence: false, totalY: null };
  }

  // 3. Line-by-line amounts. The bottom-most amount line is the total
  //    candidate; amounts on lines above it are item prices. An item price
  //    must never be mistaken for the total, so when item prices are known
  //    the candidate is only accepted if the item sum matches it (or matches
  //    another line's amount — the total is not always the bottom line).
  if (lineAmounts && lineAmounts.length) {
    const sorted = [...lineAmounts].sort((a, b) => b.y - a.y);
    const candidate = sorted[0];
    const itemSum = sorted.slice(1).reduce((s, l) => s + l.value, 0);
    if (itemSum > 0) {
      if (Math.abs(candidate.value - itemSum) / itemSum <= 0.02) {
        return { value: candidate.value, votes: 2, lowConfidence: false, totalY: candidate.y };
      }
      // The total is not always the bottom line: some other line l is the
      // total iff it equals the sum of all the OTHER lines (itemSum includes
      // l itself, so the check is 2*l ≈ itemSum).
      for (const l of sorted) {
        if (Math.abs(2 * l.value - itemSum) / itemSum <= 0.02) {
          return { value: l.value, votes: 2, lowConfidence: false, totalY: l.y };
        }
      }
      // The sum confirms no amount: an item line was likely misread or
      // missed. Do not guess — leave the total blank for the user to review.
      return { value: 0, votes: 0, lowConfidence: true, totalY: null };
    }
    // A single amount line: the total by receipt convention, but unverified
    return { value: candidate.value, votes: 1, lowConfidence: true, totalY: candidate.y };
  }

  // 4. Fast-parse total (printed receipts)
  if (fast.total > 0) return { value: fast.total, votes: 1, lowConfidence: false, totalY: null };
  return { value: 0, votes: 0, lowConfidence: true, totalY: null };
}

/** Most frequent number in a list → [value, votes]. */
function voteNumber(nums) {
  if (!nums || nums.length === 0) return [0, 0];
  const freq = {};
  for (const n of nums) freq[n] = (freq[n] || 0) + 1;
  const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  return [parseFloat(best[0]), best[1]];
}

// ── Handwritten item lines ─────────────────────────

/** Common kirana item words — used to correct OCR-mangled item names. */
const ITEM_WORDS = [
  'milk', 'bread', 'sugar', 'tea', 'rice', 'flour', 'atta', 'oil', 'ghee', 'salt', 'eggs',
  'dal', 'onions', 'potatoes', 'tomatoes', 'biscuits', 'cake', 'juice', 'water', 'soda',
  'soap', 'shampoo', 'detergent', 'tissue', 'battery', 'bulb', 'notebook', 'charger',
  'yogurt', 'butter', 'cheese', 'honey', 'coffee', 'matches', 'pack', 'bottle'
];

function fuzzyItemWord(norm) {
  if (!norm) return null;
  for (const w of ITEM_WORDS) {
    if (norm === w) return w;
    const d = levenshtein(norm, w);
    const len = Math.max(norm.length, w.length);
    if (len >= 3 && d <= 1) return w;
    // OCR often mangles the leading letters of a handwritten word ("kyead" → bread)
    if (norm.length >= 5 && w.length >= 5 && d <= 2) return w;
  }
  return null;
}

/**
 * Handwritten item lines: strips below the header that are not total/date/
 * payment lines but carry a consensus amount. The name comes from the line's
 * readings (dictionary-corrected), the price from the line's amount votes.
 */
function parseItemLines(lineReadings, lineAmounts, totalOut, labeled, fullText, vendorBottom) {
  // y positions already claimed by a labeled field or by the confirmed total row
  const claimedYs = new Set();
  for (const l of labeled) {
    if (['total', 'date', 'payment', 'vendor', 'invoice', 'change', 'discount'].includes(l.label)) claimedYs.add(l.y);
  }
  if (totalOut.totalY !== null && totalOut.totalY !== undefined) claimedYs.add(totalOut.totalY);

  const items = [];
  let nameUnconfirmed = false;
  for (const lr of lineReadings) {
    if (claimedYs.has(lr.y)) continue;
    if (vendorBottom && lr.coreY0 < vendorBottom) continue;
    const amt = lineAmounts.find((a) => a.y === lr.y);
    if (!amt) continue;
    const picked = pickItemName(lr.readings);
    if (!picked.name) continue;
    if (!picked.confirmed) nameUnconfirmed = true;
    items.push({ name: picked.name, qty: pickItemQty(lr.readings), price: amt.value });
  }
  // Sanity: the items must not wildly overshoot a confirmed total — if they
  // do, the "items" are probably junk lines and should not be saved.
  if (totalOut.value > 0) {
    const sum = items.reduce((s, i) => s + i.price, 0);
    if (sum > totalOut.value * 1.35) return { items: [], nameUnconfirmed: false };
  }
  return { items: items.slice(0, 12), nameUnconfirmed };
}

/**
 * Best item name from a line's readings: the highest-scoring token run,
 * dictionary-corrected. `confirmed` is true only when some token is a known
 * item word (fuzzy) or a plain word of ≥4 letters — a name like "Aid" from
 * an unreadable cursive line is a guess and must be flagged for review.
 */
function pickItemName(readings) {
  let best = null;
  let bestScore = -1;
  let confirmed = false;
  for (const r of readings) {
    const text = CURRENCY_MARKER.test(r) ? r.split(CURRENCY_MARKER)[0] : r;
    const toks = text
      .split(/[^A-Za-z]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !NON_VENDOR_WORDS.has(t.toLowerCase()));
    if (!toks.length) continue;
    // Prefer readings with longer words and known item words — a rescue
    // reading that found "Milk" beats an earlier "Aid" misread.
    const score = toks.reduce((s, t) => s + t.length + (fuzzyItemWord(t.toLowerCase()) ? 5 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = toks;
      confirmed = toks.some((t) => fuzzyItemWord(t.toLowerCase()) || t.length >= 4);
    }
  }
  if (!best) return { name: '', confirmed: false };
  const name = best
    .map((t) => {
      const norm = t.toLowerCase();
      const w = fuzzyItemWord(norm);
      return w ? capitalizeWord(w) : /^[A-Z]{2,}$/.test(t) ? t : capitalizeWord(norm);
    })
    .join(' ');
  return { name, confirmed };
}

/**
 * Quantity from tokens like "2", "2L", "2kg" before the amount marker.
 * A unit suffix ("2L") or a single digit is trusted; a bare multi-digit
 * number only counts when two readings agree — cursive units and strip
 * borders routinely misread as stray digits ("2L" → "17)").
 */
function pickItemQty(readings) {
  const votes = {};
  let single = 0;
  for (const r of readings) {
    const text = CURRENCY_MARKER.test(r) ? r.split(CURRENCY_MARKER)[0] : r;
    for (const t of text.split(/[^A-Za-z0-9]+/)) {
      const m = t.match(/^(\d{1,2})(?:\s*(?:l|ltr|litre|liter|kg|g|gm|pcs?|pack|dozen))?$/i);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (n < 1 || n > 99) continue;
      if (m[2]) return n; // unit suffix makes the quantity unambiguous
      if (n <= 9) single = single || n;
      else votes[n] = (votes[n] || 0) + 1;
    }
  }
  if (single) return single;
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? parseInt(best[0], 10) : 1;
}

/**
 * Loose currency-amount extraction. Handles "Rs. 3,000", "RS, 3,000",
 * "Rs 3' 000", "Rs. 3 000", "PKR 3000", "روپے 3000", "3,000/-" and the
 * mangled markers handwriting produces ("R s 1.950", "Ks. 4,950", "Pe.300").
 */
// Currency marker as OCR mangles it: "Rs", "R s", "Ks.", "Pe.", "Re", "PKR", "rp"
const CURRENCY_MARKER = /\b(?:[rkp][\s.]?[ssec5$]|rs|pkr|روپے|rp)[.,;:]?/i;

function extractAmountsLoose(text) {
  if (!text) return [];
  const out = [];
  const re = new RegExp(CURRENCY_MARKER.source + "\\s*([\\d,'\\s|olIO.]{2,14})", 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = parseLooseCapture(m[1]);
    if (v > 0 && v < 100000000) out.push(v);
  }
  const re2 = /([\d,]{3,10}(?:\.\d{1,2})?)\s*(?:\/-|rs\.?|pkr)\b/gi;
  while ((m = re2.exec(text)) !== null) {
    const v = parseAmount(m[1]);
    if (v > 0 && v < 100000000) out.push(v);
  }
  // Trailing amount: on handwritten item lines the currency mark is often
  // unreadable junk ("Bread 2 __ Pe.300") and the price is simply the last
  // number on the line (possibly followed by border artifacts like "§" or "|").
  const re3 = /(\d[\d,.]*\d|\d)\s*[^\w\s]*\s*(?:\/-)?$/gm;
  while ((m = re3.exec(text)) !== null) {
    const v = parseLooseCapture(m[1]);
    if (v > 0 && v < 100000000) out.push(v);
  }
  return out;
}

function parseLooseCapture(cap) {
  const fixed = fixOcrDigits(cap)
    .replace(/[olI|]/g, (c) => ({ o: '0', l: '1', I: '1', '|': '1' })[c])
    .replace(/O/g, '0');
  // Space-separated digit groups only join in the thousands style ("3 000",
  // "1 950"); a short group after the price is a line-number/border artifact
  // ("300 1" → 300, not 3001).
  const groups = fixed.trim().split(/\s+/).filter((g) => /\d/.test(g));
  let joined = '';
  for (let i = 0; i < groups.length; i++) {
    const digits = groups[i].replace(/[^\d.]/g, '');
    if (i === 0) {
      joined = digits;
    } else if (/^\d{3}$/.test(digits)) {
      joined += digits;
    } else {
      break;
    }
  }
  let digits = joined;
  if (!digits) return 0;
  // "1.950" — a dot misread for the thousands comma
  const dotThousands = digits.match(/^(\d{1,3})\.(\d{3})$/);
  if (dotThousands) digits = dotThousands[1] + dotThousands[2];
  const v = parseFloat(digits);
  return isNaN(v) ? 0 : v;
}

/** First amount in a labeled value (bare numbers allowed). */
function firstAmountLoose(value) {
  if (!value) return 0;
  const amounts = extractAmountsLoose(value);
  if (amounts.length) return amounts[0];
  const m = fixOcrDigits(value).match(/([\d,]{2,10}(?:\.\d{1,2})?)/);
  if (m) {
    const v = parseAmount(m[1]);
    if (v > 0) return v;
  }
  return 0;
}

// ── Vendor ensemble ────────────────────────────────────

/**
 * Assemble the vendor name by clustering tokens across readings. Readings are
 * {text, y, src} — band readings carry their vertical position so multi-line
 * shop names keep the right word order ("ABC" / "General" / "Store").
 * A cluster must be seen in ≥2 readings and be anchored by a band reading or
 * the Windows OCR text (region-block passes only corroborate — their junk
 * tokens can never qualify on their own).
 */
function assembleVendor(vendorReadings, winText) {
  const readings = [...vendorReadings];
  if (winText) readings.push({ text: winText, y: null, src: 'win' });
  if (readings.length === 0) return '';

  const tokenLists = readings.map((r) =>
    r.text
      .split(/\s+/)
      .map((tok) => tok.trim())
      .filter((tok) => {
        const clean = tok.replace(/[^\w¥]/g, '');
        if (clean.length < 2) return false;
        if (/\d/.test(clean)) return false;
        const norm = clean.toLowerCase();
        if (/^(rs|pkr|rp)$/.test(norm)) return false;
        if (NON_VENDOR_WORDS.has(norm)) return false;
        return true;
      })
  );

  // Cluster similar tokens across readings
  const clusters = [];
  readings.forEach((r, ri) => {
    tokenLists[ri].forEach((tok, pi) => {
      const norm = tok.toLowerCase().replace(/[^a-z]/g, '');
      if (!norm) return;
      for (const cl of clusters) {
        const rep = cl.items[0].norm;
        const tol = Math.max(1, Math.floor(Math.max(norm.length, rep.length) * 0.5));
        if (levenshtein(norm, rep) <= tol) {
          cl.items.push({ tok, norm, ri, pi, y: r.y, src: r.src });
          return;
        }
      }
      clusters.push({ items: [{ tok, norm, ri, pi, y: r.y, src: r.src }] });
    });
  });

  // Keep tokens seen in ≥2 readings, anchored by a band/word line position or
  // present in the Windows OCR text; order top-to-bottom (y, then position).
  const candidates = clusters
    .map((cl) => ({
      items: cl.items,
      readings: new Set(cl.items.map((i) => i.ri)),
      anchored: cl.items.some((i) => i.src === 'band' || i.src === 'win'),
      ys: cl.items.map((i) => i.y).filter((y) => y !== null && y !== undefined),
      avgPos: cl.items.reduce((s, i) => s + i.pi, 0) / cl.items.length
    }))
    .filter((cl) => {
      // 2-letter fragments from printed notebook headers ("BE") are not
      // shop-name words — drop them before they prepend to the vendor.
      const rep = clusterRepresentative(cl.items).toLowerCase().replace(/[^a-z]/g, '');
      if (rep.length <= 2 && !STORE_WORDS.includes(rep)) return false;
      return cl.readings.size >= 2 && cl.anchored;
    })
    .sort((a, b) => {
      const ya = a.ys.length ? avgNum(a.ys) : 5000 + a.avgPos;
      const yb = b.ys.length ? avgNum(b.ys) : 5000 + b.avgPos;
      return ya - yb;
    });
  console.log(
    `  [AI] Vendor clusters: ${candidates
      .map((cl) => `${clusterRepresentative(cl.items)}${cl.ys.length ? '@' + Math.round(avgNum(cl.ys)) : ''}`)
      .join(' | ')}`
  );

  let parts;
  if (candidates.length > 0) {
    parts = candidates.map((cl) => clusterRepresentative(cl.items));
  } else {
    // Single-reading fallback: correct against the store dictionary, drop junk
    const best = tokenLists.reduce((a, b) => (b.length > a.length ? b : a), []);
    parts = best
      .map((tok) => {
        const norm = tok.toLowerCase().replace(/[^a-z]/g, '');
        const dw = dictionaryMatch(norm);
        return dw ? capitalizeWord(dw) : norm.length >= 4 ? tok : null;
      })
      .filter(Boolean)
      .slice(0, 3);
  }

  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out.slice(0, 4).join(' ').trim();
}

function avgNum(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function clusterRepresentative(items) {
  if (!items || items.length === 0) return '';
  for (const it of items) {
    const dw = dictionaryMatch(it.norm);
    if (dw) return capitalizeWord(dw);
  }
  // Shop names are often written in caps ("ABC"). When the caps spelling
  // differs across readings, trust the better source first: the Windows
  // handwriting engine, then tight line strips, then the vendor block pass.
  const SRC_RANK = { win: 0, band: 1, region: 2 };
  const caps = items
    .filter((i) => /^[A-Z]{2,}$/.test(i.tok))
    .sort((a, b) => (SRC_RANK[a.src] ?? 3) - (SRC_RANK[b.src] ?? 3));
  if (caps.length) return caps[0].tok;
  const freq = {};
  for (const it of items) freq[it.tok] = (freq[it.tok] || 0) + 1;
  const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  return /^[A-Z]{2,}$/.test(best) ? best : capitalizeWord(best);
}

function dictionaryMatch(norm) {
  if (!norm) return null;
  for (const dw of STORE_WORDS) {
    const tol = Math.max(1, Math.floor(Math.max(norm.length, dw.length) * 0.3));
    if (norm === dw || levenshtein(norm, dw) <= tol) return dw;
  }
  return null;
}

function capitalizeWord(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// ── Payment ensemble ───────────────────────────────────

const PAYMENT_WORDS = [
  ['cash', 'Cash'], ['naqad', 'Cash'], ['cashon', 'Cash'],
  ['jazzcash', 'JazzCash'], ['easypaisa', 'EasyPaisa'],
  ['credit', 'Credit Card'], ['debit', 'Debit Card'], ['card', 'Card'],
  ['bank', 'Bank Transfer'], ['transfer', 'Bank Transfer'], ['online', 'Online Transfer'],
  ['udhaar', 'Credit (Udhaar)'], ['udhar', 'Credit (Udhaar)']
];

// Exact-match OCR mangles of "cash" — too short for fuzzy matching
// ("(ACh", "(oash", "Coch" on handwritten payment lines).
const PAYMENT_CASH_MANGLES = new Set(['ach', 'oach', 'coch', 'cach', 'oash', 'cosh', 'gash', 'csh']);

function extractPaymentEnsemble(payLabeled, allReadings) {
  const sources = [...payLabeled, ...allReadings];
  for (const src of sources) {
    const tokens = (src || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
    for (const tok of tokens) {
      if (PAYMENT_CASH_MANGLES.has(tok)) return 'Cash';
      for (const [w, label] of PAYMENT_WORDS) {
        const tol = w.length <= 4 ? 1 : Math.floor(w.length * 0.25);
        if (tok === w || levenshtein(tok, w) <= tol) return label;
      }
    }
  }
  return '';
}

// ══════════════════════════════════════════════════════════
// FAST-PATH PARSER (printed receipts / clean text)
// ══════════════════════════════════════════════════════════

const LABEL_PATTERNS = {
  date: /^(?:date|dt|tareekh|tarik|tareeq)\s*[:\-–]\s*(.+)$/i,
  item: /^(?:items?|item\s*name|description|desc|product|details?)\s*[:\-–]\s*(.+)$/i,
  qty: /^(?:qty|quantity|qnty|qnt|count)\s*[:\-–]\s*(.+)$/i,
  amount: /^(?:amount|amt|price|unit\s*price|rupees?|rupay|rupya)\s*[:\-–]\s*(.+)$/i,
  // Final-total labels only — deliberately NOT "subtotal" (a subtotal is
  // never the final total). Separator optional: "Total Rs. 300" and
  // "Total: Rs. 300" are both common on Pakistani receipts.
  total: /^(?:grand\s*total|net\s*total|net\s*amount|total\s*amount|total\s*due|amount\s*due|amount\s*payable|balance\s*due|total|bill\s*amount|bill|kul\s*raqam|kul|jama|raqam)\b\s*[:\-–]?\s*(.+)$/i,
  payment: /^(?:payment|payment\s*method|paid\s*by|pay\s*mode|mode\s*of\s*payment|naqad|udhaar|udhar)\s*[:\-–]?\s*(.+)$/i,
  vendor: /^(?:vendor|merchant|shop|shop\s*name|store|store\s*name|seller|from|bought\s*from|dukan|dukaan)\s*[:\-–]\s*(.+)$/i,
  category: /^(?:category|type)\s*[:\-–]\s*(.+)$/i,
  // Reference/metadata lines — labels like these must never become items
  // ("Invoice: 4417" is not an item priced at Rs. 4,417).
  invoice: /^(?:invoice|inv|bill\s*no|bill\s*#|receipt\s*no|ref\s*no|sr\s*no|#)\s*[:\-–]?\s*(\S.*)$/i,
  discount: /^(?:discount|less|off)\b\s*[:\-–]?\s*(.+)$/i,
  change: /^(?:change|cash\s*back|balance\s*returned?)\b\s*[:\-–]?\s*(.+)$/i
};

// Global (non-line-anchored) patterns for spotting repeated receipt
// "landmarks" anywhere in the OCR text — including when two receipts sit
// side by side and Tesseract reads both onto the same output line (a
// line-anchored match would only ever catch one occurrence per line).
const MULTI_TOTAL_RE = /(?:grand\s*total|net\s*total|net\s*amount|total\s*amount|total\s*due|amount\s*due|amount\s*payable|balance\s*due|bill\s*amount|kul\s*raqam|jama|total|kul|raqam)\s*[:\-–]?\s*(?:rs\.?|pkr)?\s*[\d,]+/gi;
const MULTI_DATE_RE = /\b(?:date|dt|tareekh|tarik|tareeq)\s*[:\-–]?\s*\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}/gi;
const MULTI_INVOICE_RE = /\b(?:invoice|inv|bill\s*no|bill\s*#|receipt\s*no|ref\s*no|sr\s*no)\s*[:\-–]?\s*\S+/gi;

function countGlobalMatches(rawText, pattern) {
  if (!rawText) return 0;
  const matches = rawText.match(pattern);
  return matches ? matches.length : 0;
}

// Heuristic: does the raw OCR text look like it was read from more than
// one physical receipt? Two or more independent "Total ... amount"
// occurrences is the strongest signal (a single receipt only has one
// final total). Repeated date occurrences together with repeated
// invoice/receipt-number occurrences is a weaker but still useful
// secondary signal.
function looksLikeMultipleReceipts(rawText) {
  if (!rawText) return false;
  const totalHits = countGlobalMatches(rawText, MULTI_TOTAL_RE);
  const dateHits = countGlobalMatches(rawText, MULTI_DATE_RE);
  const invoiceHits = countGlobalMatches(rawText, MULTI_INVOICE_RE);
  return totalHits >= 2 || (dateHits >= 2 && invoiceHits >= 2);
}

function parseReceiptText(rawText) {
  const lines = (rawText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result = {
    date: '',
    type: 'expense',
    category: '',
    vendor: '',
    description: '',
    items: [],
    total: 0,
    paymentMethod: '',
    lowConfidenceFields: [],
    confidence: 0
  };

  if (lines.length === 0 || !/[A-Za-z0-9]/.test(rawText || '')) {
    result.lowConfidenceFields.push('all');
    return result;
  }

  const labeled = {};
  for (const line of lines) {
    for (const [key, pattern] of Object.entries(LABEL_PATTERNS)) {
      const m = line.match(pattern);
      if (m && m[1] && m[1].trim() && !labeled[key]) {
        labeled[key] = m[1].trim();
        break;
      }
    }
  }

  // Vendor
  result.vendor = labeled.vendor ? cleanText(labeled.vendor) : guessVendor(lines) || '';

  // Date
  const dateValue = labeled.date ? parseDateValue(labeled.date) : null;
  const scannedDate = extractDateFromLines(lines);
  const foundDate = dateValue || scannedDate;
  if (foundDate) result.date = foundDate;
  else result.lowConfidenceFields.push('date');

  // Payment
  if (labeled.payment) result.paymentMethod = normalizePayment(labeled.payment);
  else {
    const pm = rawText.match(/\b(cash|card|credit|debit|jazzcash|easypaisa|bank\s*transfer|online)\b/i);
    if (pm) result.paymentMethod = normalizePayment(pm[1]);
  }

  // Items (printed style: "Rice 1kg - Rs. 200")
  const itemLines = [];
  for (const line of lines) {
    if (isLabelLine(line) && !LABEL_PATTERNS.item.test(line) && !LABEL_PATTERNS.amount.test(line)) continue;
    const item = parseItemLine(line);
    if (item) itemLines.push(item);
  }

  // Total
  let total = null;
  if (labeled.total) total = firstAmount(labeled.total);
  if (total == null) total = findTotalLine(lines);

  // Items from label-value data (handwritten style)
  if (labeled.item || labeled.amount || labeled.qty) {
    const name = cleanText(labeled.item || labeled.category || '') || 'Item';
    const qty = labeled.qty ? parseQty(labeled.qty) : 1;
    let unitPrice = labeled.amount ? firstAmount(labeled.amount) : null;
    if (unitPrice == null && total != null) unitPrice = total;
    if (unitPrice != null && unitPrice > 0) {
      result.items = [{ name, qty: qty || 1, price: qty > 1 && total != null ? total : unitPrice }];
      if (total == null) total = (qty || 1) * unitPrice;
    } else {
      result.description = name;
    }
  }

  // Items from scanned lines (printed style)
  if (result.items.length === 0 && itemLines.length > 0) {
    result.items = itemLines.map((i) => ({ name: i.name, qty: i.qty || 1, price: i.amount }));
    if (total == null) total = result.items.reduce((s, i) => s + (i.qty || 1) * i.price, 0);
  }

  // No labeled total and no total line: the only honest options are a
  // single amount on the whole receipt (a single-item receipt) or no total
  // at all. The largest of several amounts is an arbitrary item price —
  // NEVER use it as the total.
  if (total == null) {
    const allAmounts = [];
    for (const line of lines) allAmounts.push(...extractAmounts(line));
    if (allAmounts.length === 1) {
      total = allAmounts[0].value;
      if (result.items.length === 0) {
        result.items = [{ name: cleanText(labeled.item || result.vendor || 'Item'), qty: 1, price: total }];
      }
    }
  }

  result.total = total != null && total > 0 ? total : 0;

  // Category
  if (labeled.category) {
    result.category = mapCategoryToken(labeled.category) || cleanText(labeled.category);
  } else {
    result.category = inferCategory(rawText, result.vendor);
  }

  // Type — only with explicit evidence; otherwise ambiguous for user confirmation
  result.type = classifyTransactionType(rawText);

  // Description
  if (result.items.length > 0) {
    const names = result.items.map((i) => i.name).filter(Boolean).slice(0, 3);
    result.description = names.join(', ') + (result.items.length > 3 ? '...' : '');
  } else if (labeled.item) {
    result.description = cleanText(labeled.item);
  } else if (!result.description) {
    result.description = result.vendor || '';
  }

  if (!result.vendor) result.lowConfidenceFields.push('vendor');
  if (result.total === 0) result.lowConfidenceFields.push('total');
  if (result.items.length === 0) result.lowConfidenceFields.push('items');
  if (!result.paymentMethod) result.lowConfidenceFields.push('payment');
  result.lowConfidenceFields = [...new Set(result.lowConfidenceFields)];

  return result;
}

// ══════════════════════════════════════════════════════════
// SHARED PARSER HELPERS
// ══════════════════════════════════════════════════════════

function isLabelLine(line) {
  return Object.values(LABEL_PATTERNS).some((p) => p.test(line));
}

function guessVendor(lines) {
  const storeWords = /(store|shop|mart|general|wholesale|traders?|company|enterprise|bakery|pharmacy|medical|kirana|dukaan|bazaar|market|super)/i;
  for (const line of lines.slice(0, 6)) {
    if (storeWords.test(line) && !isAmountOnly(line) && !isDateLine(line)) {
      return cleanText(line.replace(/[|—–]/g, ''));
    }
  }
  for (const line of lines.slice(0, 3)) {
    if (line.length >= 3 && line.length <= 45 && !isAmountOnly(line) && !isDateLine(line) && !isLabelLine(line) && /[A-Za-z]{2,}/.test(line)) {
      return cleanText(line.replace(/[|—–]/g, ''));
    }
  }
  return '';
}

function extractAmounts(line) {
  const amounts = [];
  const patterns = [
    /(?:Rs\.?|PKR|روپے|Rs)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:\/-|Rs\.?|PKR)/gi,
    /(?:total|amount|price|sum|grand|net|bill)\s*:?\s*(?:Rs\.?|PKR)?\s*([\d,]+(?:\.\d{1,2})?)/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const value = parseAmount(match[1]);
      if (value > 0 && value < 100000000) amounts.push({ value, raw: match[0], index: match.index });
    }
  }
  const seen = new Set();
  return amounts.filter((a) => {
    if (seen.has(a.value)) return false;
    seen.add(a.value);
    return true;
  });
}

function firstAmount(value) {
  if (!value) return null;
  const amounts = extractAmounts(value);
  if (amounts.length === 0) {
    const m = value.match(/([\d,]+(?:\.\d{1,2})?)/);
    if (m) {
      const v = parseAmount(m[1]);
      if (v > 0) return v;
    }
    return null;
  }
  return amounts[0].value;
}

function parseAmount(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/,/g, '')) || 0;
}

function parseQty(value) {
  if (!value) return 1;
  const m = String(value).match(/\d+/);
  if (!m) return 1;
  const n = parseInt(m[0], 10);
  return n > 0 && n < 10000 ? n : 1;
}

function parseItemLine(line) {
  const cleaned = fixOcrDigits(line);
  const patterns = [
    /^(.+?)\s+(\d+)\s*[xX×]\s*(?:Rs\.?|PKR)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/-)?$/,
    /^(.+?)\s+(?:Rs\.?|PKR)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/-)?$/,
    /^(.{2,40}?)\s+([\d,]{3,}(?:\.\d{1,2})?)\s*(?:\/-)?$/
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      if (match.length === 4) {
        const name = cleanText(match[1]);
        const qty = parseInt(match[2], 10) || 1;
        const amount = parseAmount(match[3]);
        if (name && amount > 0 && !isReservedKeyword(name)) return { name, qty, amount };
      } else if (match.length === 3) {
        const name = cleanText(match[1]);
        const amount = parseAmount(match[2]);
        if (name && amount > 0 && !isReservedKeyword(name)) return { name, qty: 1, amount };
      }
    }
  }
  return null;
}

function findTotalLine(lines) {
  const patterns = [
    /(?:grand\s*)?total(?:\s*amount)?\s*:?\s*(?:Rs\.?|PKR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:net\s*)?amount\s*:?\s*(?:Rs\.?|PKR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:Rs\.?|PKR)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/-)?\s*(?:grand\s*)?total/i,
    // Roman Urdu total keywords: kul, kul raqam, jama, raqam
    /(?:kul\s*(?:raqam)?|jama|raqam)\s*:?\s*(?:Rs\.?|PKR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:Rs\.?|PKR)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/-)?\s*(?:kul|jama)/i
  ];
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
    for (const pattern of patterns) {
      const match = fixOcrDigits(lines[i]).match(pattern);
      if (match) {
        const value = parseAmount(match[1]);
        if (value > 0) return value;
      }
    }
  }
  return null;
}

function parseDateValue(value) {
  if (!value) return null;
  const v = fixOcrDigits(value);
  let m = v.match(/(\d{1,2})[\s\-./]+([A-Za-z]{3,9})\.?[\s\-./,]+(\d{2,4})/);
  if (m) {
    const month = normalizeMonth(m[2]);
    const day = parseInt(m[1], 10);
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
      return `${year}-${MONTH_NUM[month]}-${String(day).padStart(2, '0')}`;
    }
  }
  m = v.match(/([A-Za-z]{3,9})\.?[\s\-./]+(\d{1,2}),?[\s\-./]+(\d{2,4})/);
  if (m) {
    const month = normalizeMonth(m[1]);
    const day = parseInt(m[2], 10);
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
      return `${year}-${MONTH_NUM[month]}-${String(day).padStart(2, '0')}`;
    }
  }
  return parseNumericDate(v);
}

function extractDateFromLines(lines) {
  for (const line of lines) {
    const parsed = parseDateValue(line);
    if (parsed) return parsed;
  }
  return null;
}

function parseNumericDate(v) {
  let m = v.match(/(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = v.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    const day = parseInt(d, 10);
    const month = parseInt(mo, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function normalizeMonth(str) {
  if (!str) return null;
  const s = str.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
  if (MONTHS.includes(s)) return s;
  for (const m of MONTHS) {
    if (levenshtein(s, m) <= 1) return m;
  }
  return null;
}

function normalizePayment(value) {
  if (!value) return '';
  const v = value.toLowerCase();
  if (/jazz\s*cash|jazzcash/.test(v)) return 'JazzCash';
  if (/easy\s*paisa|easypaisa/.test(v)) return 'EasyPaisa';
  if (/bank|transfer|online/.test(v)) return 'Bank Transfer';
  if (/cred/.test(v)) return 'Credit Card';
  if (/deb/.test(v)) return 'Debit Card';
  if (/card/.test(v)) return 'Card';
  if (/cash|naqad/.test(v)) return 'Cash';
  return cleanText(value);
}

function mapCategoryToken(value) {
  const v = (value || '').toLowerCase();
  const rules = [
    [/grocer|inventor|stock|kirana|ration/, 'Inventory'],
    [/utilit|electric|bijli|gas|sngpl|lesco|water|bill/, 'Utilities'],
    [/rent|kiraya/, 'Rent'],
    [/deliver|courier|bykea|shipping/, 'Delivery'],
    [/packag|packing|bag|box|wrap/, 'Packaging'],
    [/salar|wage|payroll|staff|helper|employee/, 'Staff Salary'],
    [/transport|rickshaw|bus|taxi|fuel|petrol|diesel|fare/, 'Transport'],
    [/repair|maintain|fix/, 'Maintenance'],
    [/market|advert|ad\b|promot|flyer|banner/, 'Marketing'],
    [/sale|income|revenue/, 'Daily Sales']
  ];
  for (const [re, cat] of rules) if (re.test(v)) return cat;
  return null;
}

function inferCategory(text, vendor) {
  const combined = (text + ' ' + (vendor || '')).toLowerCase();
  const rules = [
    { keywords: ['flour', 'atta', 'sugar', 'cheeni', 'oil', 'ghee', 'rice', 'chawal', 'dal', 'spice', 'masala', 'grocery', 'groceries', 'milk', 'doodh', 'bread', 'roti', 'biscuit', 'tea', 'chai', 'inventory', 'ration', 'kirana', 'general store', 'karyana'], category: 'Inventory' },
    { keywords: ['electric', 'bijli', 'gas', 'sngpl', 'lesco', 'water', 'pani', 'utility', 'utilities', 'bill', 'internet', 'wifi', 'broadband'], category: 'Utilities' },
    { keywords: ['rent', 'kiraya'], category: 'Rent' },
    { keywords: ['delivery', 'courier', 'bykea', 'foodpanda', 'shipping'], category: 'Delivery' },
    { keywords: ['packaging', 'packing', 'bag', 'box', 'wrap'], category: 'Packaging' },
    { keywords: ['salary', 'wage', 'payroll', 'helper', 'staff', 'employee'], category: 'Staff Salary' },
    { keywords: ['rickshaw', 'bus', 'taxi', 'fuel', 'petrol', 'diesel', 'transport', 'fare'], category: 'Transport' },
    { keywords: ['repair', 'maintenance', 'fix'], category: 'Maintenance' },
    { keywords: ['advert', 'marketing', 'promotion', 'flyer', 'banner'], category: 'Marketing' }
  ];
  for (const rule of rules) {
    if (rule.keywords.some((kw) => combined.includes(kw))) return rule.category;
  }
  return 'Inventory';
}

// ══════════════════════════════════════════════════════════
// TEXT UTILITIES
// ══════════════════════════════════════════════════════════

function fixOcrDigits(s) {
  if (!s) return s;
  return s
    .replace(/(?<=\d)[lIL|]/g, '1')
    .replace(/[lIL|](?=\d)/g, '1')
    .replace(/(?<=\d)O/g, '0')
    .replace(/O(?=\d)/g, '0');
}

function isAmountOnly(line) {
  const stripped = line.replace(/(?:Rs\.?|PKR|روپے|[\d,.\s\/\-])/gi, '');
  return stripped.length === 0 && /\d/.test(line);
}

function isDateLine(line) {
  return (
    /\d{1,2}[\s/.\-]\d{1,2}[\s/.\-]\d{2,4}/.test(line) ||
    /\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}/.test(line) ||
    /\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{2,4}/.test(line)
  );
}

function isReservedKeyword(text) {
  const reserved = ['total', 'subtotal', 'sub total', 'grand total', 'amount', 'net', 'balance', 'change', 'tax', 'gst', 'discount', 'date', 'payment', 'qty', 'quantity'];
  return reserved.some((r) => (text || '').toLowerCase().includes(r));
}

function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/[^\w\s.,()\-/&']/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–]\s*$/g, '')
    .trim();
}

/** Assemble the debug "Raw extracted text" shown in the review screen. */
function formatRawText(fullText, winText, lineReadings) {
  const parts = [];
  parts.push('=== Full-page OCR (Tesseract) ===');
  parts.push((fullText || '(no text)').trim());
  if (winText) {
    parts.push('');
    parts.push('=== Windows native OCR (second engine) ===');
    parts.push(winText.trim());
  }
  if (lineReadings && lineReadings.length) {
    parts.push('');
    parts.push('=== Line-by-line analysis (enhanced scan) ===');
    for (const lr of lineReadings) {
      const shown = lr.readings.slice(0, 3).map((r) => `"${r}"`).join('  |  ');
      parts.push(shown);
    }
  }
  return parts.join('\n');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[n];
}

// ══════════════════════════════════════════════════════════
// AI VISION FALLBACK
// ══════════════════════════════════════════════════════════

const AI_VISION_PROMPT = `You are a receipt analyzer for Pakistani small businesses.
Analyze the attached receipt image and extract structured data.

LANGUAGE SUPPORT:
This receipt may be in English, Urdu script, Roman Urdu (Urdu written in Latin characters), or a mix of these. Read the receipt directly from the image — do not rely on OCR text from another engine.
- Recognize Roman Urdu receipt terms: kul (total), kul raqam (total amount), jama (total/collection), raqam (amount), tareekh/tarik (date), naqad (cash), udhaar (credit), bikri/becha (sale), kharcha/khareeda (expense), dukan/dukaan (shop/store), maal (goods), supplier se liya (bought from supplier).
- Recognize Urdu script labels: کل (total), کل رقم (total amount), تاریخ (date), نقد (cash), ادائیگی (payment), دکان (shop), دکاندار (shopkeeper), رقم (amount), فروخت (sale), خرید (purchase), خرچہ (expense), خریدا (purchased), مال (goods), قابل ادائیگی (amount due), جمع (collection/total), رسید (receipt).
- Recognize Urdu/Arabic-Indic digits: ۰=0, ۱=1, ۲=2, ۳=3, ۴=4, ۵=5, ۶=6, ۷=7, ۸=8, ۹=9. Also handle Western digits (0-9).
- Recognize common Urdu product/grocery terms: چاول (rice), چینی (sugar), دودھ (milk), تیل (oil), کوکنگ آئل (cooking oil), بسکٹ (biscuit), آٹا (flour), چائے (tea), کلو (kg), لیٹر (liter), روپے (rupees).
- Handle Urdu date formats like "4 ستمبر 2026" and normalize to YYYY-MM-DD.
- Preserve the original language of item names and vendor names — do NOT translate them.

STRICT RULES:
- Extract ONLY what you can actually read on the image. Do NOT invent, guess, or hallucinate values.
- For fields you cannot read, return an empty string (text fields) or 0 (numeric fields).
- Recognize Pakistani currency: Rs., Rs, PKR, or bare numeric amounts.
- For dates, use YYYY-MM-DD format. Recognize Urdu month names if present.
- Do NOT calculate a total from items — only return a total if you see an explicit "Total", "Grand Total", "Net Total", "Amount Due", "Bill Amount", "Kul", "Kul Raqam", "Jama", or similar label.
- Set quantity to 1 if no quantity is visible.
- Transaction type: return "sale" ONLY if the image explicitly shows a sale to a customer (e.g. "Sale", "Sold", "Bikri", "Becha", "فروخت"). Return "expense" ONLY if it explicitly shows a purchase/business expense (e.g. "Purchase", "Supplier", "Bought", "Kharcha", "Khareeda", "خرچہ", "خرید"). If there is no such evidence, return "ambiguous" — do NOT guess based on the vendor name, item list, total amount, or payment method.

Return a JSON object with EXACTLY these fields:
{
  "vendor": "shop or store name visible on the receipt",
  "date": "YYYY-MM-DD date or empty string",
  "paymentMethod": "Cash, Card, JazzCash, EasyPaisa, or empty string",
  "category": "one of: Inventory, Utilities, Rent, Food, Transport, Salary, Packaging, Delivery, Other",
  "type": "\"sale\", \"expense\", or \"ambiguous\"",
  "items": [
    {"name": "item name", "quantity": 1, "unitPrice": 100, "lineTotal": 100}
  ],
  "total": 0,
  "confidence": 80
}`;

// ── Multi-receipt detection prompt ─────────────────────────
// Used when we want to detect whether an image contains more than one receipt.
const MULTI_RECEIPT_PROMPT = `You are a receipt analyzer for Pakistani small businesses.
The attached image may contain ONE or MULTIPLE separate receipts (e.g. a photo of a table with several receipts, or multiple receipts side-by-side).

FIRST: Count how many distinct, separate receipts you can see in the image. Each receipt is a physically separate piece of paper or a clearly distinct block of text with its own header/store name and totals.

LANGUAGE SUPPORT:
Receipts may be in English, Urdu script, Roman Urdu (Urdu in Latin characters), or a mix. Read the receipt directly from the image. Recognize Roman Urdu terms (kul=total, jama=total, tareekh=date, naqad=cash, bikri/becha=sale, kharcha/khareeda=expense, dukan=shop, maal=goods) and Urdu script labels (کل=total, کل رقم=total amount, تاریخ=date, نقد=cash, ادائیگی=payment, دکان=shop, دکاندار=shopkeeper, رقم=amount, فروخت=sale, خرید=purchase, خرچہ=expense, خریدا=purchased, مال=goods, قابل ادائیگی=amount due, جمع=collection, رسید=receipt). Handle Urdu/Arabic-Indic digits (۰-۹) and Western digits (0-9). Recognize Urdu product terms (چاول=rice, چینی=sugar, دودھ=milk, تیل=oil, آٹا=flour, چائے=tea, کلو=kg, لیٹر=liter, روپے=rupees). Preserve original language of item/vendor names.

STRICT RULES:
- Do NOT split a single long receipt into multiple parts. Only count receipts that are physically separate documents.
- Extract ONLY what you can actually read. Do NOT invent, guess, or hallucinate values.
- For fields you cannot read, return an empty string (text) or 0 (numeric).
- Recognize Pakistani currency: Rs., Rs, PKR, or bare numeric amounts.
- Dates: YYYY-MM-DD format. Recognize Urdu month names if present.
- Do NOT calculate totals from items — only return a total if explicitly visible ("Total", "Kul", "Kul Raqam", "Jama", etc.).
- Set quantity to 1 if no quantity is visible.
- Transaction type: "sale" ONLY if explicit evidence (e.g. "Sale", "Bikri", "Becha", "فروخت"). "expense" ONLY if explicit evidence (e.g. "Purchase", "Kharcha", "Khareeda", "خرچہ"). Otherwise "ambiguous".

Return a JSON object with EXACTLY this structure:
{
  "receiptCount": 1,
  "receipts": [
    {
      "vendor": "shop or store name",
      "date": "YYYY-MM-DD or empty",
      "paymentMethod": "Cash, Card, JazzCash, EasyPaisa, or empty",
      "category": "one of: Inventory, Utilities, Rent, Food, Transport, Salary, Packaging, Delivery, Other",
      "type": "sale, expense, or ambiguous",
      "items": [{"name": "item name", "quantity": 1, "unitPrice": 100, "lineTotal": 100}],
      "total": 0,
      "confidence": 80
    }
  ]
}

IMPORTANT:
- receiptCount MUST equal the length of the receipts array.
- If you see only ONE receipt, return receiptCount: 1 with a single-element array.
- If you see MULTIPLE separate receipts, return each one as a separate element.
- Never return receiptCount > actual number of receipts visible.`;

/**
 * Decide whether the OCR extraction is too unreliable to use directly.
 * Returns true when AI Vision fallback should be attempted.
 *
 * The check considers BOTH field presence AND field confidence:
 *   - A garbled vendor string (non-empty but flagged low-confidence) is
 *     treated the same as a missing vendor — the old check only counted
 *     empty fields, which let weak results slip through.
 *   - A total that cannot be validated against line items is treated as
 *     unreliable for the fallback decision.
 *   - The fallback requires at least 2 CONFIDENT critical fields;
 *     without them, the extraction is not trustworthy enough to use.
 *
 * Payment method is deliberately NOT counted: many receipts simply don't
 * state it, and its absence must not demote an otherwise solid extraction.
 */
function isOcrUnusable(result) {
  const { extracted, confidence } = result;
  const flags = extracted.lowConfidenceFields || [];

  // Total OCR failure
  if (flags.includes('all')) return true;

  // Critical fields that are MISSING or flagged LOW-CONFIDENCE.
  // A garbled non-empty value (flagged by the parser) is just as
  // unreliable as an empty one — treat both as "not solid".
  const weak = [];
  if (!extracted.vendor || flags.includes('vendor')) weak.push('vendor');
  if (!extracted.date   || flags.includes('date'))   weak.push('date');
  if (!extracted.total  || flags.includes('total'))  weak.push('total');
  if ((!extracted.items || extracted.items.length === 0) || flags.includes('items')) weak.push('items');

  // Count fields that are present AND confident (solid evidence)
  const solid = ['vendor', 'date', 'total', 'items'].filter(f => !weak.includes(f));

  // Items missing or low-confidence weakens the extraction, but a receipt
  // with solid vendor + date + total is still usable — the user can add
  // items manually on the review screen.  Only force AI Vision when the
  // non-item fields are also weak.
  if (weak.includes('items') && solid.length < 3) return true;

  // Require at least 3 of 4 critical fields to be solid.  A receipt
  // with only 2 confident fields is not trustworthy enough to skip
  // AI Vision (when available).
  if (solid.length < 3) return true;

  // Very low confidence with no validated total
  if (confidence < 50 && (!extracted.total || flags.includes('total'))) return true;

  return false;
}

async function callOpenAI(base64, mime, apiKey) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: AI_VISION_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
      ]
    }],
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 90_000);

  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (fetchErr) {
    console.log(`  [AI Vision] OpenAI fetch failed: ${fetchErr.message}${fetchErr.cause ? ' (' + (fetchErr.cause.message || fetchErr.cause.code) + ')' : ''}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.log(`  [AI Vision] OpenAI error ${resp.status}: ${errText.slice(0, 300)}`);
    return null;
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    console.log('  [AI Vision] OpenAI returned empty response');
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    console.log(`  [AI Vision] OpenAI returned non-JSON: ${content.slice(0, 200)}`);
    return null;
  }
}

async function callGemini(base64, mime, apiKey) {
  const primary   = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  // Alternate model for 503/timeout fallback — picks a different generation
  // to ride out transient demand spikes on any single model.
  const alternate = (primary.includes('3.5') || primary.includes('lite'))
    ? 'gemini-3.8-flash'
    : 'gemini-3.5-flash';

  async function geminiCall(model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [
        { text: AI_VISION_PROMPT },
        { inline_data: { mime_type: mime, data: base64 } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 2000
    }
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30_000);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (fetchErr) {
    // AbortController timeout — re-throw so outer catch tries the alternate model
    if (/abort/i.test(fetchErr.message)) {
      const err = new Error(`Gemini (${model}) request aborted (30s timeout)`);
      err.statusCode = 0;
      throw err;
    }
    console.log(`  [AI Vision] Gemini fetch failed: ${fetchErr.message}${fetchErr.cause ? ' (' + (fetchErr.cause.message || fetchErr.cause.code) + ')' : ''}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const err = new Error(`Gemini error ${resp.status}: ${errText.slice(0, 300)}`);
    err.statusCode = resp.status;
    throw err;
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.log(`  [AI Vision] Gemini (${model}) returned empty response`);
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.log(`  [AI Vision] Gemini (${model}) returned non-JSON: ${text.slice(0, 200)}`);
    return null;
  }
  } // end geminiCall

  // Circuit breaker: if primary is dead, try alternate directly
  const primaryDead = (geminiCB[primary]?.failures || 0) >= 2;
  if (primaryDead) {
    console.log(`  [AI Vision] ${primary} circuit-broken (${geminiCB[primary].failures} failures) — skipping to ${alternate}`);
    if ((geminiCB[alternate]?.failures || 0) >= 2) {
      console.log(`  [AI Vision] ${alternate} also circuit-broken (${geminiCB[alternate].failures} failures) — skipping`);
      return null;
    }
    try {
      const altResult = await geminiCall(alternate);
      if (geminiCB[alternate]) geminiCB[alternate].failures = 0;
      return altResult;
    } catch (e2) {
      if (geminiCB[alternate]) geminiCB[alternate].failures++;
      console.log(`  [AI Vision] ${alternate} also failed: ${e2.message}`);
      return null;
    }
  }

  // Try primary model first, then alternate on 503/timeout
  try {
    const result = await geminiCall(primary);
    if (geminiCB[primary]) geminiCB[primary].failures = 0;
    return result;
  } catch (err) {
    if (geminiCB[primary]) geminiCB[primary].failures++;
    const is503 = err.statusCode === 503;
    const isAbort = /aborted/i.test(err.message);
    if (is503 || isAbort) {
      console.log(`  [AI Vision] ${primary} unavailable (${err.statusCode || 'abort'}) — trying ${alternate}...`);
      // Circuit breaker: skip alternate if it's been failing consecutively
      if ((geminiCB[alternate]?.failures || 0) >= 2) {
        console.log(`  [AI Vision] ${alternate} circuit-broken (${geminiCB[alternate].failures} failures) — skipping`);
        return null;
      }
      try {
        const altResult = await geminiCall(alternate);
        if (geminiCB[alternate]) geminiCB[alternate].failures = 0;
        return altResult;
      } catch (e2) {
        if (geminiCB[alternate]) geminiCB[alternate].failures++;
        console.log(`  [AI Vision] ${alternate} also failed: ${e2.message}`);
        return null;
      }
    }
    console.log(`  [AI Vision] Gemini error: ${err.message}`);
    return null;
  }
}

/**
 * Parse a model response into JSON, tolerating the noise some models add:
 * markdown code fences, <think> reasoning blocks (qwen3 thinking mode),
 * or leading/trailing prose. Returns the parsed object or null.
 */
function parseJsonLoose(text) {
  if (!text) return null;
  const candidates = [text];
  // Strip qwen3 thinking blocks if present
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (noThink && noThink !== text) candidates.push(noThink);
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch {}
    // Strip markdown code fences
    const unfenced = candidate.replace(/```(?:json)?/gi, '').trim();
    try { return JSON.parse(unfenced); } catch {}
    // Extract the outermost JSON object
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch {}
    }
  }
  return null;
}

/**
 * Call Groq (qwen multimodal vision models) with the single-receipt prompt.
 * Mirrors callGemini(): primary model first (GROQ_MODEL, default
 * qwen/qwen3.8-27b), automatic fallback to qwen/qwen3.6-27b when the
 * primary fails or is unavailable (429/5xx/timeout), per-model circuit
 * breaker. Uses the official xAI-style OpenAI-compatible Groq endpoint.
 */
async function callGroq(base64, mime, apiKey) {
  const primary   = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
  const alternate = (primary === 'qwen/qwen3.6-27b') ? 'qwen/qwen3.8-27b' : 'qwen/qwen3.6-27b';

  async function groqCall(model) {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const body = {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: AI_VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
        ]
      }],
      temperature: 0.1,
      // Free tier (on_demand) enforces 1000 output tokens/minute (OTPM) on
      // the account — requests with a higher cap are rejected with 429
      // "Request too large" BEFORE running. Kept at 500 (not the full 1000)
      // so a single-receipt read still leaves headroom, within the same
      // rolling minute, for the follow-up multi-receipt-prompt call that
      // orchestrateMultiExtraction now always makes after this one.
      max_completion_tokens: 500,
      response_format: { type: 'json_object' }
    };
    // Disable qwen3 thinking mode where supported — receipts need fast
    // deterministic JSON, not reasoning chains. 'none' is supported by
    // both qwen3.6-27b and qwen3.8-27b (Qwen 3 family only).
    if (model.includes('qwen3')) body.reasoning_effort = 'none';

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30_000);

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (fetchErr) {
      // AbortController timeout — re-throw so the outer catch tries the alternate model
      if (/abort/i.test(fetchErr.message)) {
        const err = new Error(`Groq (${model}) request aborted (30s timeout)`);
        err.statusCode = 0;
        throw err;
      }
      console.log(`  [AI Vision] Groq fetch failed: ${fetchErr.message}${fetchErr.cause ? ' (' + (fetchErr.cause.message || fetchErr.cause.code) + ')' : ''}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(`Groq error ${resp.status}: ${errText.slice(0, 300)}`);
      err.statusCode = resp.status;
      throw err;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.log(`  [AI Vision] Groq (${model}) returned empty response`);
      return null;
    }

    const parsed = parseJsonLoose(content);
    if (!parsed) {
      console.log(`  [AI Vision] Groq (${model}) returned non-JSON: ${content.slice(0, 200)}`);
    }
    return parsed;
  }

  // Circuit breaker: if primary is dead, try alternate directly
  const primaryDead = (groqCB[primary]?.failures || 0) >= 2;
  if (primaryDead) {
    console.log(`  [AI Vision] ${primary} circuit-broken (${groqCB[primary].failures} failures) — skipping to ${alternate}`);
    if ((groqCB[alternate]?.failures || 0) >= 2) {
      console.log(`  [AI Vision] ${alternate} also circuit-broken (${groqCB[alternate].failures} failures) — skipping`);
      return null;
    }
    try {
      const altResult = await groqCall(alternate);
      if (groqCB[alternate]) groqCB[alternate].failures = 0;
      return altResult;
    } catch (e2) {
      if (groqCB[alternate]) groqCB[alternate].failures++;
      console.log(`  [AI Vision] ${alternate} also failed: ${e2.message.slice(0, 200)}`);
      return null;
    }
  }

  // Try primary model first; on ANY failure (429 rate limit, 5xx, timeout —
  // common on the free tier) automatically fall back to the alternate model.
  try {
    const result = await groqCall(primary);
    if (groqCB[primary]) groqCB[primary].failures = 0;
    return result;
  } catch (err) {
    if (groqCB[primary]) groqCB[primary].failures++;
    console.log(`  [AI Vision] ${primary} unavailable (${err.statusCode || 'network'}) — trying ${alternate}...`);
    if ((groqCB[alternate]?.failures || 0) >= 2) {
      console.log(`  [AI Vision] ${alternate} circuit-broken (${groqCB[alternate].failures} failures) — skipping`);
      return null;
    }
    try {
      const altResult = await groqCall(alternate);
      if (groqCB[alternate]) groqCB[alternate].failures = 0;
      return altResult;
    } catch (e2) {
      if (groqCB[alternate]) groqCB[alternate].failures++;
      console.log(`  [AI Vision] ${alternate} also failed: ${e2.message.slice(0, 200)}`);
      return null;
    }
  }
}

async function callAIVision(filePath) {
  if (AI_PROVIDER === 'ocr' || AI_PROVIDER === 'demo') return null;

  const apiKey = AI_PROVIDER === 'openai' ? OPENAI_KEY
               : AI_PROVIDER === 'google' ? GEMINI_KEY
               : AI_PROVIDER === 'groq'   ? GROQ_KEY
               : '';

  if (!apiKey) {
    console.log(`  [AI Vision] Provider "${AI_PROVIDER}" selected but API key is missing — skipping`);
    return null;
  }

  // Read the original (unprocessed) image as base64
  const buffer = await fs.promises.readFile(filePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mime = (ext === '.png') ? 'image/png' : 'image/jpeg';

  console.log(`  [AI Vision] Calling ${AI_PROVIDER} (${(buffer.length / 1024).toFixed(0)} KB image)...`);

  // The provider may transiently fail (503 high-demand, network aborts) —
  // retry a couple of times before giving up and falling back to OCR.
  let raw = null;
  const maxAttempts = 2;  // reduced from 3: with primary+alternate per attempt, 2 attempts cover 4 model tries
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      raw = AI_PROVIDER === 'openai'
        ? await callOpenAI(base64, mime, apiKey)
        : AI_PROVIDER === 'groq'
          ? await callGroq(base64, mime, apiKey)
          : await callGemini(base64, mime, apiKey);
    } catch (err) {
      console.log(`  [AI Vision] ${AI_PROVIDER} call failed (attempt ${attempt}/${maxAttempts}): ${err.message.slice(0, 120)}`);
      raw = null;
    }
    if (raw) break;
    if (attempt < maxAttempts) {
      const delay = 3;
      console.log(`  [AI Vision] Attempt ${attempt}/${maxAttempts} failed — retrying in ${delay}s...`);
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }
  }

  if (!raw) return null;

  // Normalize AI JSON → our internal extracted shape
  const items = Array.isArray(raw.items)
    ? raw.items.map(i => ({
        name:  String(i.name || '').trim(),
        qty:   Number(i.quantity) || 1,
        price: Number(i.lineTotal) || Number(i.unitPrice) || 0
      })).filter(i => i.name && i.price > 0)
    : [];

  const total         = Number(raw.total) || 0;
  const vendor        = String(raw.vendor || '').trim();
  const date          = String(raw.date || '').trim();
  const paymentMethod = String(raw.paymentMethod || '').trim();
  const category      = String(raw.category || 'Other').trim();
  const type          = (raw.type === 'sale') ? 'sale' : (raw.type === 'expense') ? 'expense' : 'ambiguous';
  const confidence    = Math.min(100, Math.max(0, Number(raw.confidence) || 50));
  const description   = items.map(i => i.name).join(', ');

  // Compute low-confidence flags from what's missing
  const lowConfidenceFields = [];
  if (!vendor)        lowConfidenceFields.push('vendor');
  if (!date)          lowConfidenceFields.push('date');
  if (total === 0)    lowConfidenceFields.push('total');
  if (items.length === 0) lowConfidenceFields.push('items');
  if (!paymentMethod) lowConfidenceFields.push('payment');
  if (!description)   lowConfidenceFields.push('description');

  // Validate total vs item sum (flag mismatch)
  const itemSum = items.reduce((s, i) => s + i.qty * i.price, 0);
  if (itemSum > 0 && total > 0) {
    const diff = Math.abs(itemSum - total);
    const pct  = diff / Math.max(itemSum, total);
    if (pct > 0.05) {
      console.log(`  [AI Vision] Warning: total ${total} differs from item sum ${itemSum} by ${(pct * 100).toFixed(0)}%`);
      if (!lowConfidenceFields.includes('total')) lowConfidenceFields.push('total');
    }
  }

  return {
    extracted: {
      vendor, date, type, category, description,
      items, total, paymentMethod, lowConfidenceFields
    },
    confidence
  };
}

// ══════════════════════════════════════════════════════════
// ORCHESTRATION — public top-level entry point
// ══════════════════════════════════════════════════════════

/**
 * Orchestrates the full extraction pipeline:
 *   1. Local OCR (Tesseract + Windows OCR)
 *   2. Quality evaluation
 *   3. AI Vision fallback (if configured and OCR is unusable)
 *
 * Returns { extracted, mode, engines, rawText, confidence, source }
 */
// An AI Vision extraction that contains nothing at all (no vendor, date,
// total, or items) means the model could not understand the image either —
// treat it as a failure so manual review becomes the final fallback.
function isAiResultEmpty(extracted) {
  return !extracted.vendor &&
         !extracted.date &&
         !extracted.total &&
         (!extracted.items || extracted.items.length === 0);
}

export async function orchestrateExtraction(filePath) {
  // ── Step 0: Image-level Urdu script detection ──────────
  // Check the raw image file for embedded Urdu/Arabic Unicode text
  // (EXIF/XMP metadata from digitally-created receipts). If found,
  // skip the entire Tesseract OCR pipeline — English-only Tesseract
  // cannot read Urdu script and would waste 30-60 seconds producing
  // garbage. Route directly to AI Vision which handles Urdu natively.
  const imageHasUrdu = detectUrduInImage(filePath);
  if (imageHasUrdu && AI_PROVIDER !== 'ocr' && AI_PROVIDER !== 'demo') {
    console.log(`  [AI] Urdu script detected in image metadata — skipping local OCR, routing directly to ${AI_PROVIDER} AI Vision`);
    const aiResult = await callAIVision(filePath);
    if (aiResult && !isAiResultEmpty(aiResult.extracted)) {
      const e = aiResult.extracted;
      console.log(`  [AI Vision] Urdu image success — vendor="${e.vendor}", total=Rs. ${e.total}, items=${e.items.length}, confidence=${aiResult.confidence}%`);
      return {
        extracted:   aiResult.extracted,
        mode:        'ai-vision',
        engines:     AI_PROVIDER,
        rawText:     '',
        confidence:  aiResult.confidence,
        source:      'ai-vision',
        aiAttempted: true
      };
    }
    console.log(`  [AI Vision] Urdu image — AI Vision failed, will fall through to OCR pipeline`);
  }

  // Step 1: Run the local OCR pipeline (never modified)
  let ocrResult;
  let ocrCrashed = false;
  try {
    ocrResult = await extractFromImage(filePath);
  } catch (ocrErr) {
    ocrCrashed = true;
    console.log(`  [AI] OCR pipeline crashed: ${ocrErr.message}`);

    // If AI Vision is configured, try it even though OCR crashed
    if (AI_PROVIDER !== 'ocr' && AI_PROVIDER !== 'demo') {
      console.log(`  [AI] Trying ${AI_PROVIDER} AI Vision as fallback after OCR crash...`);
      const aiResult = await callAIVision(filePath);
      if (aiResult && !isAiResultEmpty(aiResult.extracted)) {
        const e = aiResult.extracted;
        console.log(`  [AI Vision] Success (OCR-crash fallback) — vendor="${e.vendor}", total=Rs. ${e.total}, items=${e.items.length}`);
        return {
          extracted:  aiResult.extracted,
          mode:       'ai-vision',
          engines:    AI_PROVIDER,
          rawText:    '',
          confidence: aiResult.confidence,
          source:     'ai-vision'
        };
      }
      console.log(`  [AI Vision] Also failed — re-throwing OCR error`);
    }
    // No AI provider or AI also failed — re-throw the original OCR error
    throw ocrErr;
  }

  // Step 2: Urdu script detection
  // If the OCR raw text contains Urdu/Arabic script characters, local
  // English-only Tesseract cannot reliably extract the content. Route
  // directly to AI Vision when a provider is available.
  const hasUrduScript = detectUrduScript(ocrResult.rawText);
  if (hasUrduScript && AI_PROVIDER !== 'ocr' && AI_PROVIDER !== 'demo') {
    console.log(`  [AI] Urdu script detected in OCR output — routing to ${AI_PROVIDER} AI Vision for accurate extraction`);
    const aiResult = await callAIVision(filePath);
    if (aiResult && !isAiResultEmpty(aiResult.extracted)) {
      const e = aiResult.extracted;
      console.log(`  [AI Vision] Urdu receipt success — vendor="${e.vendor}", total=Rs. ${e.total}, items=${e.items.length}, confidence=${aiResult.confidence}%`);
      return {
        extracted:  aiResult.extracted,
        mode:       'ai-vision',
        engines:    AI_PROVIDER,
        rawText:    ocrResult.rawText,
        confidence: aiResult.confidence,
        source:     'ai-vision'
      };
    }
    console.log(`  [AI Vision] Urdu receipt — AI Vision failed, returning OCR result for manual review`);
  }

  // Step 3: Evaluate OCR quality — based on extraction quality, not just confidence
  const e = ocrResult.extracted;
  const ocrFlags = (e.lowConfidenceFields || []);
  const fieldSummary = `vendor=${e.vendor ? '"' + e.vendor.slice(0, 20) + '"' : 'MISSING'}${ocrFlags.includes('vendor') ? '(lowConf)' : ''}, ` +
    `date=${e.date || 'MISSING'}${ocrFlags.includes('date') ? '(lowConf)' : ''}, ` +
    `total=Rs.${e.total}${ocrFlags.includes('total') ? '(lowConf)' : ''}, ` +
    `items=${e.items ? e.items.length : 0}${ocrFlags.includes('items') ? '(lowConf)' : ''}`;

  if (!isOcrUnusable(ocrResult)) {
    console.log(`  [AI] OCR quality OK — conf ${ocrResult.confidence}%, ${fieldSummary}`);
    console.log(`  [AI] Fallback decision: USE OCR (sufficient confident fields)`);
    return { ...ocrResult, source: 'ocr' };
  }

  console.log(`  [AI] OCR quality too low — conf ${ocrResult.confidence}%, ${fieldSummary}`);
  console.log(`  [AI] Low-confidence fields: ${ocrFlags.join(', ') || 'none'}`);
  console.log(`  [AI] Fallback decision: TRY AI VISION (insufficient confident fields)`);

  // Step 3: Try AI Vision if a provider is configured
  if (AI_PROVIDER === 'ocr' || AI_PROVIDER === 'demo') {
    console.log(`  [AI] No AI Vision provider configured (AI_PROVIDER=${AI_PROVIDER}) — returning OCR result for manual review`);
    return { ...ocrResult, source: 'ocr' };
  }

  const aiResult = await callAIVision(filePath);

  if (aiResult && !isAiResultEmpty(aiResult.extracted)) {
    const e = aiResult.extracted;
    console.log(`  [AI Vision] Success — vendor="${e.vendor}", total=Rs. ${e.total}, items=${e.items.length}, confidence=${aiResult.confidence}%`);
    return {
      extracted:  aiResult.extracted,
      mode:       'ai-vision',
      engines:    AI_PROVIDER,
      rawText:    ocrResult.rawText,   // preserve OCR raw text for debugging
      confidence: aiResult.confidence,
      source:     'ai-vision'
    };
  }

  // AI Vision call failed (or understood nothing) — fall back to the OCR
  // result + manual review screen: manual entry is the LAST resort only.
  console.log(`  [AI Vision] Failed${aiResult ? ' (returned an empty extraction)' : ''} — returning OCR result for manual review`);
  // Mark that AI Vision was attempted so orchestrateMultiExtraction knows
  // not to retry with the multi-receipt prompt
  return { ...ocrResult, source: 'ocr', aiAttempted: true };
}

// ══════════════════════════════════════════════════════════
// MULTI-RECEIPT DETECTION — public entry point
// ══════════════════════════════════════════════════════════

/**
 * Normalize a single AI-returned receipt JSON into our internal shape.
 * Mirrors the normalization logic in callAIVision.
 */
function normalizeAiReceipt(raw) {
  const items = Array.isArray(raw.items)
    ? raw.items.map(i => ({
        name:  String(i.name || '').trim(),
        qty:   Number(i.quantity) || 1,
        price: Number(i.lineTotal) || Number(i.unitPrice) || 0
      })).filter(i => i.name && i.price > 0)
    : [];

  const total         = Number(raw.total) || 0;
  const vendor        = String(raw.vendor || '').trim();
  const date          = String(raw.date || '').trim();
  const paymentMethod = String(raw.paymentMethod || '').trim();
  const category      = String(raw.category || 'Other').trim();
  const type          = (raw.type === 'sale') ? 'sale' : (raw.type === 'expense') ? 'expense' : 'ambiguous';
  const confidence    = Math.min(100, Math.max(0, Number(raw.confidence) || 50));
  const description   = items.map(i => i.name).join(', ');

  const lowConfidenceFields = [];
  if (!vendor)        lowConfidenceFields.push('vendor');
  if (!date)          lowConfidenceFields.push('date');
  if (total === 0)    lowConfidenceFields.push('total');
  if (items.length === 0) lowConfidenceFields.push('items');
  if (!paymentMethod) lowConfidenceFields.push('payment');
  if (!description)   lowConfidenceFields.push('description');

  // Validate total vs item sum
  const itemSum = items.reduce((s, i) => s + i.qty * i.price, 0);
  if (itemSum > 0 && total > 0) {
    const diff = Math.abs(itemSum - total);
    const pct  = diff / Math.max(itemSum, total);
    if (pct > 0.05 && !lowConfidenceFields.includes('total')) {
      lowConfidenceFields.push('total');
    }
  }

  return {
    extracted: {
      vendor, date, type, category, description,
      items, total, paymentMethod, lowConfidenceFields
    },
    confidence
  };
}

/**
 * Call Gemini with the multi-receipt detection prompt.
 * Returns parsed JSON with { receiptCount, receipts: [...] } or null on failure.
 * Reuses the same model/fallback chain as callGemini.
 */
async function callMultiReceiptVision(filePath) {
  if (AI_PROVIDER === 'ocr' || AI_PROVIDER === 'demo') return null;

  const apiKey = AI_PROVIDER === 'google' ? GEMINI_KEY
               : AI_PROVIDER === 'openai' ? OPENAI_KEY
               : AI_PROVIDER === 'groq'   ? GROQ_KEY
               : '';
  if (!apiKey) return null;

  const buffer = await fs.promises.readFile(filePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mime = (ext === '.png') ? 'image/png' : 'image/jpeg';

  console.log(`  [Multi-Receipt] Calling ${AI_PROVIDER} for multi-receipt detection (${(buffer.length / 1024).toFixed(0)} KB)...`);

  // Multi-receipt is implemented for Gemini and Groq (OpenAI path not implemented for multi)
  const isGroq = AI_PROVIDER === 'groq';
  if (!isGroq && AI_PROVIDER !== 'google') return null;

  const primary   = isGroq
    ? (process.env.GROQ_MODEL || 'qwen/qwen3.8-27b')
    : (process.env.GEMINI_MODEL || 'gemini-3.5-flash');
  const alternate = isGroq
    ? (primary === 'qwen/qwen3.6-27b' ? 'qwen/qwen3.8-27b' : 'qwen/qwen3.6-27b')
    : ((primary.includes('3.5') || primary.includes('lite')) ? 'gemini-3.8-flash' : 'gemini-3.5-flash');

  async function geminiMultiCall(model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = {
      contents: [{
        parts: [
          { text: MULTI_RECEIPT_PROMPT },
          { inline_data: { mime_type: mime, data: base64 } }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 4000  // higher for multiple receipts
      }
    };

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 120_000); // 2 min for multi

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (fetchErr) {
      // AbortController timeout — re-throw so outer catch tries the alternate model
      if (/abort/i.test(fetchErr.message)) {
        const err = new Error(`Gemini (${model}) request aborted (multi-receipt 120s timeout)`);
        err.statusCode = 0;
        throw err;
      }
      console.log(`  [Multi-Receipt] Gemini fetch failed: ${fetchErr.message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(`Gemini error ${resp.status}: ${errText.slice(0, 300)}`);
      err.statusCode = resp.status;
      throw err;
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.log(`  [Multi-Receipt] Gemini (${model}) returned empty response`);
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      console.log(`  [Multi-Receipt] Gemini (${model}) returned non-JSON: ${text.slice(0, 200)}`);
      return null;
    }
  }

  // ── Groq multi-receipt call (qwen vision) ─────────────
  async function groqMultiCall(model) {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const body = {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: MULTI_RECEIPT_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
        ]
      }],
      temperature: 0.1,
      // Free tier OTPM limit is 1000 output tokens/minute — a higher cap is
      // rejected with 429 before the request runs. Multi-receipt JSON with
      // 2-3 receipts fits; larger output would truncate → parse fail →
      // graceful OCR fallback anyway.
      max_completion_tokens: 1000,
      response_format: { type: 'json_object' }
    };
    if (model.includes('qwen3')) body.reasoning_effort = 'none';

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 120_000); // 2 min for multi

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (fetchErr) {
      // AbortController timeout — re-throw so the outer catch tries the alternate model.
      // An aborted request must NEVER be swallowed as a successful result.
      if (/abort/i.test(fetchErr.message)) {
        const err = new Error(`Groq (${model}) request aborted (multi-receipt 120s timeout)`);
        err.statusCode = 0;
        throw err;
      }
      console.log(`  [Multi-Receipt] Groq fetch failed: ${fetchErr.message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(`Groq error ${resp.status}: ${errText.slice(0, 300)}`);
      err.statusCode = resp.status;
      throw err;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.log(`  [Multi-Receipt] Groq (${model}) returned empty response`);
      return null;
    }

    const parsed = parseJsonLoose(content);
    if (!parsed) {
      console.log(`  [Multi-Receipt] Groq (${model}) returned non-JSON: ${content.slice(0, 200)}`);
    }
    return parsed;
  }

  // Provider-specific call function and circuit-breaker state — Groq
  // failures only count toward groqCB, Gemini failures only toward geminiCB.
  const modelCall = isGroq ? groqMultiCall : geminiMultiCall;
  const cb = isGroq ? groqCB : geminiCB;

  // Try primary, fallback to alternate on transient failure (503/timeout;
  // Groq additionally on 429 — rate limits are common on the free tier)
  let raw = null;
  const primaryDead   = (cb[primary]?.failures || 0) >= 2;
  const alternateDead = (cb[alternate]?.failures || 0) >= 2;

  if (primaryDead && alternateDead) {
    console.log(`  [Multi-Receipt] Both ${AI_PROVIDER} models circuit-broken — skipping multi-receipt detection`);
    return null;
  }

  try {
    const model = primaryDead ? alternate : primary;
    if (primaryDead) console.log(`  [Multi-Receipt] ${primary} circuit-broken — using ${alternate}`);
    raw = await modelCall(model);
    if (cb[model]) cb[model].failures = 0;
  } catch (err) {
    const failedModel = primaryDead ? alternate : primary;
    if (cb[failedModel]) cb[failedModel].failures++;
    const transient = err.statusCode === 503 || err.statusCode === 0 || /aborted/i.test(err.message)
      || (isGroq && (err.statusCode === 429 || err.statusCode === 500 || err.statusCode === 502 || err.statusCode === 504));
    if (transient && !primaryDead && !alternateDead) {
      console.log(`  [Multi-Receipt] ${failedModel} unavailable (${err.statusCode || 'abort'}) — trying ${alternate}...`);
      try {
        raw = await modelCall(alternate);
        if (cb[alternate]) cb[alternate].failures = 0;
      } catch (e2) {
        if (cb[alternate]) cb[alternate].failures++;
        return null;
      }
    } else {
      console.log(`  [Multi-Receipt] ${isGroq ? 'Groq' : 'Gemini'} error: ${err.message.slice(0, 200)}`);
      return null;
    }
  }

  if (!raw) return null;

  // Validate the response structure
  const count = Number(raw.receiptCount) || 0;
  const receipts = Array.isArray(raw.receipts) ? raw.receipts : [];

  if (receipts.length === 0) {
    console.log(`  [Multi-Receipt] ${AI_PROVIDER} returned 0 receipts`);
    return null;
  }

  console.log(`  [Multi-Receipt] ${AI_PROVIDER} detected ${receipts.length} receipt(s)`);
  return { receiptCount: receipts.length, receipts };
}

/**
 * Multi-receipt extraction entry point — OCR-first with smart early exit.
 *
 * Pipeline order:
 *   1. Run the full local OCR pipeline first (orchestrateExtraction).
 *   2. If OCR produces a high-confidence result → return immediately (fast path).
 *   3. Only if OCR quality is low AND a cloud AI provider is available,
 *      call Gemini for multi-receipt detection + better extraction.
 *   4. If Gemini detects 2+ receipts → return multi-receipt results.
 *      Otherwise → return the OCR result.
 *
 * No OCR strategies are removed or simplified. The fast path is purely an
 * early-exit optimization that skips the cloud AI call when OCR already
 * produced a reliable result.
 *
 * Returns:
 *   { multi: true, receipts: [{ extracted, mode, confidence, source }, ...] }
 *   OR the same shape as orchestrateExtraction for a single receipt
 */
export async function orchestrateMultiExtraction(filePath) {
  // ── Fast path: no cloud AI provider available ──────────
  // Skip multi-receipt detection entirely (it requires Gemini).
  if (AI_PROVIDER === 'ocr' || AI_PROVIDER === 'demo') {
    const singleResult = await orchestrateExtraction(filePath);
    return { multi: false, ...singleResult };
  }

  // ── Step 1: Run the full OCR pipeline first ───────────
  // This includes preprocessing, all threshold variants, full-page OCR,
  // rotation rescue, Windows OCR, ensemble line-by-line analysis,
  // and AI Vision fallback within orchestrateExtraction if OCR is weak.
  let ocrResult;
  try {
    ocrResult = await orchestrateExtraction(filePath);
  } catch (ocrErr) {
    // OCR crashed entirely — orchestrateExtraction already tried AI Vision
    // internally if configured. Re-throw; the server handles the error.
    throw ocrErr;
  }

  // ── Step 2: Evaluate result quality ───────────────────
  // If OCR (or the internal AI Vision fallback) already produced a
  // high-confidence result with all critical fields, return immediately.
  // No additional Gemini call is needed.
  const e = ocrResult.extracted;
  const confidence = ocrResult.confidence || 0;
  const alreadyUsedAI = ocrResult.source === 'ai-vision' || ocrResult.mode === 'ai-vision' || ocrResult.aiAttempted === true;

  // Safety net: a "confident" single-receipt extraction is not proof the
  // photo only contains one receipt — OCR (or a single-receipt AI Vision
  // fallback) can read one receipt cleanly while simply ignoring a second
  // or third receipt elsewhere in the frame. Scan the raw OCR text for
  // signs of more than one receipt (e.g. two separate "Total" lines, or
  // repeated date + invoice-number lines) so those cases still go through
  // multi-receipt detection instead of being short-circuited here.
  const suspiciousMultiple = looksLikeMultipleReceipts(ocrResult.rawText);

  // A confident result is only safe to skip multi-detection for when it
  // came from OCR alone (a clean, simple read strongly suggests a single,
  // well-framed receipt). A confident result that came from the internal
  // single-receipt AI Vision fallback does NOT prove there is only one
  // receipt in the photo — that fallback's prompt only ever looks for one
  // receipt, so a hard-to-read OCR pass (which is why it ran in the first
  // place) combined with a confident single-receipt read is exactly the
  // scenario where a second or third receipt can be silently missed.
  const highConfidence =
    !alreadyUsedAI &&
    confidence >= 75 &&
    e.total > 0 &&
    e.vendor &&
    e.date &&
    !suspiciousMultiple;

  if (highConfidence) {
    console.log(`  [Multi-Receipt] High-confidence OCR-only result (conf=${confidence}%, vendor="${e.vendor}", total=Rs. ${e.total}) — skipping multi-receipt detection`);
    return { multi: false, ...ocrResult };
  }

  // ── Step 3: Low-quality OCR, suspected multiple receipts, or AI Vision ──
  // already used for a single-receipt read — always worth the extra
  // multi-receipt-prompt call now, since none of those three situations
  // rules out a second or third receipt in the frame.
  if (alreadyUsedAI) {
    console.log(`  [Multi-Receipt] AI Vision already returned a single-receipt result (conf=${confidence}%, vendor="${e.vendor}") — its prompt only looks for one receipt, so checking for additional ones...`);
  } else if (suspiciousMultiple) {
    console.log(`  [Multi-Receipt] OCR text shows signs of more than one receipt (repeated total/date/invoice lines) — checking for multiple receipts...`);
  } else {
    console.log(`  [Multi-Receipt] OCR quality low (conf=${confidence}%, vendor=${!!e.vendor}, total=${e.total}, date=${!!e.date}) — checking for multiple receipts...`);
  }

  // Circuit breaker: if both models are exhausted from earlier AI Vision attempts,
  // skip multi-receipt detection entirely — it would only waste time and quota.
  // Provider-aware: Groq failures only break Groq, Gemini failures only break Gemini.
  const cb = AI_PROVIDER === 'groq' ? groqCB : geminiCB;
  const bothDead = Object.values(cb).every((s) => (s?.failures || 0) >= 2);
  if (bothDead) {
    console.log(`  [Multi-Receipt] Both ${AI_PROVIDER} models circuit-broken — skipping multi-receipt detection`);
    return { multi: false, ...ocrResult };
  }

  const multiResult = await callMultiReceiptVision(filePath);

  if (multiResult && multiResult.receipts.length >= 2) {
    console.log(`  [Multi-Receipt] Detected ${multiResult.receipts.length} receipts`);
    const receipts = multiResult.receipts.map((raw, idx) => {
      const normalized = normalizeAiReceipt(raw);
      const ne = normalized.extracted;
      console.log(`  [Multi-Receipt] Receipt ${idx + 1}: vendor="${ne.vendor}", total=Rs. ${ne.total}, items=${ne.items.length}, type=${ne.type}`);
      return {
        extracted: normalized.extracted,
        mode: 'ai-vision',
        engines: AI_PROVIDER,
        rawText: '',
        confidence: normalized.confidence,
        source: 'ai-vision'
      };
    });
    return { multi: true, receipts };
  }

  // Multi-receipt detection found exactly 1 receipt — use it as a single
  // receipt extraction. This is a safety net: when the OCR pipeline
  // produced a useless result AND the regular AI Vision call failed,
  // the multi-receipt prompt may still extract the single receipt correctly.
  if (multiResult && multiResult.receipts.length === 1) {
    const normalized = normalizeAiReceipt(multiResult.receipts[0]);
    const ne = normalized.extracted;
    const hasUsefulData = ne.vendor || ne.total > 0 || ne.date || (ne.items && ne.items.length > 0);
    if (hasUsefulData) {
      console.log(`  [Multi-Receipt] Single receipt extracted via multi-receipt prompt — vendor="${ne.vendor}", total=Rs. ${ne.total}, items=${ne.items.length}`);
      return {
        multi: false,
        extracted: ne,
        mode: 'ai-vision',
        engines: AI_PROVIDER,
        rawText: '',
        confidence: normalized.confidence,
        source: 'ai-vision'
      };
    }
  }

  // ── Safety net: all critical fields empty ────────────────
  // If we reach here with a completely empty extraction AND AI Vision
  // is available, make one last attempt with the single-receipt prompt.
  // This handles edge cases where both OCR and the first AI Vision call
  // failed (transient 503, timeout, model overload).
  const allEmpty = !e.vendor && !e.date && !e.total && (!e.items || e.items.length === 0);
  if (allEmpty && AI_PROVIDER !== 'ocr' && AI_PROVIDER !== 'demo' && !alreadyUsedAI) {
    console.log(`  [Multi-Receipt] All critical fields empty — making final AI Vision attempt with single-receipt prompt`);
    const lastAttempt = await callAIVision(filePath);
    if (lastAttempt && !isAiResultEmpty(lastAttempt.extracted)) {
      const le = lastAttempt.extracted;
      console.log(`  [AI Vision] Final attempt success — vendor="${le.vendor}", total=Rs. ${le.total}, items=${le.items.length}`);
      return {
        multi: false,
        extracted: lastAttempt.extracted,
        mode: 'ai-vision',
        engines: AI_PROVIDER,
        rawText: ocrResult.rawText || '',
        confidence: lastAttempt.confidence,
        source: 'ai-vision'
      };
    }
  }

  // Multi-receipt detection found 1 receipt or failed — return OCR result
  console.log(`  [Multi-Receipt] Multi-detection did not find 2+ receipts — returning OCR result`);
  return { multi: false, ...ocrResult };
}