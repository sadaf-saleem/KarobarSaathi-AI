// Diagnose Groq OTPM limits (key from .env, never printed).
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const key = (env.match(/^\s*GROQ_API_KEY\s*=\s*(\S+)\s*$/m) || [])[1];
if (!key) { console.log('GROQ_API_KEY NOT FOUND'); process.exit(1); }

async function tryModel(model, maxTokens) {
  const body = {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly this json: {"ok":true}' }],
    max_completion_tokens: maxTokens,
    temperature: 0,
    response_format: { type: 'json_object' }
  };
  if (model.includes('qwen3')) body.reasoning_effort = 'none';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const txt = await res.text();
  if (res.ok) {
    const data = JSON.parse(txt);
    console.log(`${model} max_completion_tokens=${maxTokens}: HTTP ${res.status} OK — content: ${JSON.stringify(data.choices?.[0]?.message?.content).slice(0, 80)}`);
  } else {
    // Extract the full error message (contains the actual limits)
    let msg = txt;
    try { msg = JSON.parse(txt)?.error?.message || txt; } catch {}
    console.log(`${model} max_completion_tokens=${maxTokens}: HTTP ${res.status} — ${msg}`);
  }
}

for (const model of ['qwen/qwen3.8-27b', 'qwen/qwen3.6-27b']) {
  await tryModel(model, 2000);
  await new Promise(r => setTimeout(r, 2000));
}
// Then try smaller caps
console.log('\n--- smaller caps ---');
await tryModel('qwen/qwen3.8-27b', 1000);
await new Promise(r => setTimeout(r, 2000));
await tryModel('qwen/qwen3.8-27b', 500);
