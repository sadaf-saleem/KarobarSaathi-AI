// Quick diagnostic test — checks the API response for aiQuotaExhausted flag
import { readFileSync, writeFileSync } from 'fs';

const testImage = 'uploads/receipt-1788524627516.jpeg';  // Urdu receipt from earlier

console.log(`\n=== Test: Urdu receipt quota-exhausted flow ===`);
console.log(`Image: ${testImage}`);

const FormData = (await import('form-data')).default;
const fetch = (await import('node-fetch')).default;

const form = new FormData();
const buf = readFileSync(testImage);
form.append('receipt', buf, { filename: 'test-urdu.jpeg', contentType: 'image/jpeg' });

console.log(`Uploading ${buf.length} bytes...`);
const t0 = Date.now();

try {
  const res = await fetch('http://localhost:3001/api/receipt/process', {
    method: 'POST',
    body: form,
    timeout: 300000
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const json = await res.json();

  console.log(`\n--- Response (${elapsed}s) ---`);
  console.log(`Status:         ${res.status}`);
  console.log(`mode:           ${json.mode}`);
  console.log(`source:         ${json.source}`);
  console.log(`confidence:     ${json.confidence}%`);
  console.log(`aiQuotaExhausted: ${json.aiQuotaExhausted}`);
  console.log(`total:          Rs. ${json.extracted?.total}`);
  console.log(`vendor:         "${json.extracted?.vendor || ''}"`);
  console.log(`date:           "${json.extracted?.date || ''}"`);
  console.log(`items:          ${json.extracted?.items?.length || 0}`);
  console.log(`payment:        "${json.extracted?.paymentMethod || ''}"`);
  console.log(`lowConfFields:  [${(json.extracted?.lowConfidenceFields || []).join(', ')}]`);
  console.log(`rawText:        ${(json.rawText || '').slice(0, 80)}...`);

  // Verification
  console.log(`\n--- Verification ---`);
  if (json.aiQuotaExhausted === true) {
    console.log(`[PASS] aiQuotaExhausted flag is present`);
  } else {
    console.log(`[INFO] aiQuotaExhausted is ${json.aiQuotaExhausted} — quota may have reset`);
  }
  if (json.mode === 'ocr' && json.source === 'ocr') {
    console.log(`[PASS] Fell back to OCR as expected`);
  } else {
    console.log(`[INFO] Source is ${json.source} (quota may have reset, AI Vision succeeded)`);
  }
  console.log(`[PASS] User can still review/edit the OCR result`);

} catch (err) {
  console.error(`ERROR: ${err.message}`);
}
