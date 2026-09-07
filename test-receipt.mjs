import fs from 'fs';
import path from 'path';

const file = process.argv[2];
if (!file) { console.error('Usage: node test-receipt.mjs <image-path>'); process.exit(1); }
const filePath = path.resolve(file);

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const fileData = fs.readFileSync(filePath);
const boundary = '----FormBoundary' + Date.now().toString(36);

const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="receipt"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
  fileData,
  Buffer.from(`\r\n--${boundary}--\r\n`)
]);

const start = Date.now();
console.log(`Uploading: ${path.basename(filePath)} (${(fileData.length / 1024).toFixed(0)} KB)`);

const res = await fetch('http://localhost:3001/api/receipt/process', {
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length.toString()
  },
  body: body
});

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const data = await res.json();

console.log(`\nStatus: ${res.status} | Time: ${elapsed}s`);
console.log(`Mode: ${data.mode} | Source: ${data.source || '-'} | Confidence: ${data.confidence}%`);
console.log(`Multi: ${data.multi}`);
console.log(`Vendor: ${data.extracted?.vendor || '(empty)'}`);
console.log(`Date: ${data.extracted?.date || '(empty)'}`);
console.log(`Total: ${data.extracted?.total || '(empty)'}`);
console.log(`Type: ${data.extracted?.type || '(empty)'}`);
console.log(`Category: ${data.extracted?.category || '(empty)'}`);
console.log(`Payment: ${data.extracted?.paymentMethod || '(empty)'}`);
console.log(`Items: ${(data.extracted?.items || []).length}`);
if (data.extracted?.items?.length > 0) {
  data.extracted.items.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.name} x${item.qty || '?'} @ Rs.${item.price || '?'} = Rs.${(item.qty || 0) * (item.price || 0)}`);
  });
}
console.log(`Low-confidence: ${data.extracted?.lowConfidenceFields?.join(', ') || 'none'}`);
if (data.multi && data.receipts) {
  console.log(`\n--- Multi-receipt: ${data.receipts.length} receipts ---`);
  data.receipts.forEach((r, i) => {
    console.log(`Receipt ${i + 1}: ${r.extracted.vendor || '(no vendor)'} | ${r.extracted.date} | Rs.${r.extracted.total} | conf=${r.confidence}% | items=${(r.extracted.items || []).length}`);
  });
}
