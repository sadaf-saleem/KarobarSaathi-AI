// Diagnoses whether the multi-receipt Groq call is getting truncated by
// the 1000 output-token cap when given a REAL photo. Run with:
//   node diag-multi-receipt.mjs path/to/your/2-or-3-receipt-photo.jpg
import fs from 'fs';

const imagePath = process.argv[2];
if (!imagePath) {
  console.log('Usage: node diag-multi-receipt.mjs <path-to-receipt-photo>');
  process.exit(1);
}

const env = fs.readFileSync('.env', 'utf8');
const key = (env.match(/^\s*GROQ_API_KEY\s*=\s*(\S+)\s*$/m) || [])[1];
if (!key) { console.log('GROQ_API_KEY NOT FOUND in .env'); process.exit(1); }

const imgBuf = fs.readFileSync(imagePath);
const base64 = imgBuf.toString('base64');
const ext = imagePath.split('.').pop().toLowerCase();
const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

// Same prompt the app itself sends for multi-receipt detection.
const MULTI_RECEIPT_PROMPT = `You are a receipt analyzer for Pakistani small businesses.
The attached image may contain ONE or MULTIPLE separate receipts (e.g. a photo of a table with several receipts, or multiple receipts side-by-side).

FIRST: Count how many distinct, separate receipts you can see in the image. Each receipt is a physically separate piece of paper or a clearly distinct block of text with its own header/store name and totals.

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
Return ONLY the JSON object, nothing else.`;

async function run() {
  const body = {
    model: 'qwen/qwen3.8-27b',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: MULTI_RECEIPT_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
      ]
    }],
    temperature: 0.1,
    max_completion_tokens: 1000,
    response_format: { type: 'json_object' }
  };
  body.reasoning_effort = 'none';

  console.log(`Sending ${imagePath} (${(imgBuf.length / 1024).toFixed(0)} KB) to qwen/qwen3.8-27b...`);
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });

  const txt = await res.text();
  if (!res.ok) {
    console.log(`HTTP ${res.status} — ${txt.slice(0, 500)}`);
    return;
  }

  const data = JSON.parse(txt);
  const choice = data.choices?.[0];
  const content = choice?.message?.content || '';
  const finishReason = choice?.finish_reason;
  const usage = data.usage;

  console.log(`\nHTTP ${res.status} OK`);
  console.log(`finish_reason: ${finishReason}  ${finishReason === 'length' ? '  <-- TRUNCATED (hit max_completion_tokens before finishing)' : ''}`);
  console.log(`output tokens used: ${usage?.completion_tokens ?? 'unknown'} / 1000`);
  console.log(`content length: ${content.length} chars`);

  try {
    const parsed = JSON.parse(content);
    console.log(`\nJSON PARSED OK — receiptCount: ${parsed.receiptCount}, receipts returned: ${parsed.receipts?.length}`);
    parsed.receipts?.forEach((r, i) => console.log(`  #${i + 1}: ${r.vendor} | Rs.${r.total} | items=${r.items?.length}`));
  } catch (e) {
    console.log(`\nJSON PARSE FAILED: ${e.message}`);
    console.log(`\n--- last 300 chars of content (where it likely got cut off) ---`);
    console.log(content.slice(-300));
  }
}

run().catch(e => console.log('Error:', e.message));
