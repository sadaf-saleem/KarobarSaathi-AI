import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { orchestrateExtraction, orchestrateMultiExtraction } from './ai-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Config ──────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DB_PATH = path.join(ROOT, 'data', 'karobarsaathi.db');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ── Database ────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('sale','expense')),
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    source TEXT DEFAULT 'manual',
    receipt_url TEXT DEFAULT '',
    vendor TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// ── Express App ─────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

// Serve frontend in production
if (isProd) {
  app.use(express.static(path.join(ROOT, 'dist')));
}

// ── Multer for receipt uploads ──────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `receipt-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ══════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════

// ── GET /api/transactions ───────────────────────────────
app.get('/api/transactions', (req, res) => {
  const { type, category, from, to, limit, offset } = req.query;
  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];

  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to) { sql += ' AND date <= ?'; params.push(to); }

  sql += ' ORDER BY date DESC, created_at DESC';

  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
  if (offset) { sql += ' OFFSET ?'; params.push(Number(offset)); }

  const rows = db.prepare(sql).all(...params);
  rows.forEach(r => { try { r.items = JSON.parse(r.items); } catch { r.items = []; } });
  res.json(rows);
});

// ── GET /api/transactions/:id ───────────────────────────
app.get('/api/transactions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Transaction not found' });
  try { row.items = JSON.parse(row.items); } catch { row.items = []; }
  res.json(row);
});

// ── POST /api/transactions ──────────────────────────────
app.post('/api/transactions', (req, res) => {
  const { date, type, category, amount, description, items, source, receipt_url, vendor } = req.body;
  if (!date || !type || !category || amount == null) {
    return res.status(400).json({ error: 'Missing required fields: date, type, category, amount' });
  }
  // The receipt pipeline can yield an "ambiguous" type when the receipt gives
  // no evidence of Sale vs Expense — the user must confirm one before saving.
  if (type !== 'sale' && type !== 'expense') {
    return res.status(400).json({ error: 'Transaction type must be "sale" or "expense". Please confirm the type on the review screen.' });
  }
  const id = uuidv4();
  db.prepare(`
    INSERT INTO transactions (id, date, type, category, amount, description, items, source, receipt_url, vendor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, date, type, category, amount, description || '', JSON.stringify(items || []), source || 'manual', receipt_url || '', vendor || '');

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  try { row.items = JSON.parse(row.items); } catch { row.items = []; }
  res.status(201).json(row);
});

// ── PUT /api/transactions/:id ───────────────────────────
app.put('/api/transactions/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });

  const { date, type, category, amount, description, items, vendor } = req.body;
  if (type && type !== 'sale' && type !== 'expense') {
    return res.status(400).json({ error: 'Transaction type must be "sale" or "expense".' });
  }
  db.prepare(`
    UPDATE transactions SET date=?, type=?, category=?, amount=?, description=?, items=?, vendor=?
    WHERE id=?
  `).run(
    date || existing.date, type || existing.type, category || existing.category,
    amount ?? existing.amount, description ?? existing.description,
    items ? JSON.stringify(items) : existing.items, vendor ?? existing.vendor,
    req.params.id
  );

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  try { row.items = JSON.parse(row.items); } catch { row.items = []; }
  res.json(row);
});

// ── DELETE /api/transactions/:id ────────────────────────
app.delete('/api/transactions/:id', (req, res) => {
  const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ success: true });
});

// ── POST /api/receipt/process ───────────────────────────
// Receipt upload + real AI/OCR extraction (with multi-receipt support)
app.post('/api/receipt/process', upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No receipt image uploaded' });

  const receiptUrl = `/uploads/${req.file.filename}`;
  const filePath = req.file.path;

  try {
    console.log(`[Receipt] Processing: ${req.file.filename} (${req.file.size} bytes)`);
    const result = await orchestrateMultiExtraction(filePath);

    // ── Multi-receipt response ──────────────────────
    if (result.multi && result.receipts.length >= 2) {
      console.log(`[Receipt] Multi-receipt: ${result.receipts.length} receipts detected`);
      const receipts = result.receipts.map((r, idx) => {
        r.extracted.receipt_url = receiptUrl;
        r.extracted.source = 'receipt_scan';
        const srcLabel = r.source === 'ai-vision' ? 'AI Vision' : 'OCR';
        console.log(`[Receipt] #${idx + 1}: ${srcLabel} | conf=${r.confidence}% | total=Rs. ${r.extracted.total} | items=${r.extracted.items.length}`);
        return {
          extracted: r.extracted,
          mode: r.mode,
          source: r.source || 'ocr',
          rawText: r.rawText,
          confidence: r.confidence
        };
      });
      return res.json({ multi: true, receipts, receipt_url: receiptUrl });
    }

    // ── Single-receipt response (unchanged behavior) ──
    const single = result;
    single.extracted.receipt_url = receiptUrl;
    single.extracted.source = 'receipt_scan';

    const sourceLabel = single.source === 'ai-vision' ? 'AI Vision' : 'OCR';
    console.log(`[Receipt] Source: ${sourceLabel} | confidence: ${single.confidence}%`);
    console.log(`[Receipt] Extracted total: Rs. ${single.extracted.total}`);
    console.log(`[Receipt] Items found: ${single.extracted.items.length}`);
    if (single.extracted.lowConfidenceFields.length > 0) {
      console.log(`[Receipt] Low-confidence fields: ${single.extracted.lowConfidenceFields.join(', ')}`);
    }

    res.json({
      multi: false,
      receipt_url: receiptUrl,
      extracted: single.extracted,
      mode: single.mode,
      source: single.source || 'ocr',
      rawText: single.rawText,
      confidence: single.confidence
    });
  } catch (err) {
    console.error('[Receipt] Processing failed:', err.message);
    res.status(422).json({
      error: err.message || 'Failed to process receipt image.',
      receipt_url: receiptUrl,
      mode: 'error',
      // Always surface whatever raw OCR text was collected before the
      // failure, so the user (and we) can see what the engines read.
      rawText: err.rawText || ''
    });
  }
});

// ── GET /api/insights ───────────────────────────────────
app.get('/api/insights', (req, res) => {
  const insights = generateInsights();
  res.json(insights);
});

// ── GET /api/dashboard ──────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const totalSales = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='sale'").get().v;
  const totalExpenses = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='expense'").get().v;
  const txCount = db.prepare('SELECT COUNT(*) as v FROM transactions').get().v;
  const profit = totalSales - totalExpenses;

  // Monthly breakdown for charts (last 6 months)
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total
    FROM transactions GROUP BY month, type ORDER BY month DESC LIMIT 12
  `).all();

  // Category breakdown for expenses
  const expenseByCategory = db.prepare(`
    SELECT category, SUM(amount) as total FROM transactions
    WHERE type='expense' GROUP BY category ORDER BY total DESC
  `).all();

  // Recent transactions
  const recent = db.prepare('SELECT * FROM transactions ORDER BY date DESC, created_at DESC LIMIT 5').all();
  recent.forEach(r => { try { r.items = JSON.parse(r.items); } catch { r.items = []; } });

  res.json({
    totalSales, totalExpenses, profit, txCount,
    monthly, expenseByCategory, recent
  });
});

// ── POST /api/seed ──────────────────────────────────────
app.post('/api/seed', (req, res) => {
  seedDemoData();
  res.json({ success: true, message: 'Demo data loaded' });
});

// ── GET /api/categories ─────────────────────────────────
app.get('/api/categories', (_req, res) => {
  res.json({
    sale: ['Daily Sales', 'Wholesale', 'Online Order', 'Custom Order', 'Service Fee', 'Other Income'],
    expense: ['Inventory', 'Utilities', 'Rent', 'Delivery', 'Packaging', 'Staff Salary', 'Marketing', 'Maintenance', 'Transport', 'Other Expense']
  });
});

// ── SPA fallback (production) ───────────────────────────
if (isProd) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(ROOT, 'dist', 'index.html'));
  });
}

// ══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════

function demoExtraction() {
  const today = new Date().toISOString().split('T')[0];
  const scenarios = [
    {
      type: 'expense', category: 'Inventory', vendor: 'Al-Madina Wholesale',
      items: [
        { name: 'Atta (Flour) 10kg', qty: 2, price: 1800 },
        { name: 'Cheeni (Sugar) 5kg', qty: 3, price: 850 },
        { name: 'Cooking Oil 5L', qty: 2, price: 2200 }
      ],
      description: 'Grocery inventory restock'
    },
    {
      type: 'expense', category: 'Utilities', vendor: 'LESCO / SNGPL',
      items: [
        { name: 'Electricity Bill', qty: 1, price: 4500 },
        { name: 'Gas Bill', qty: 1, price: 2100 }
      ],
      description: 'Monthly utility payments'
    },
    {
      type: 'sale', category: 'Daily Sales', vendor: '',
      items: [
        { name: 'Morning Sales', qty: 1, price: 8500 },
        { name: 'Evening Sales', qty: 1, price: 6200 }
      ],
      description: 'Daily shop sales'
    }
  ];

  const s = scenarios[Math.floor(Math.random() * scenarios.length)];
  const total = s.items.reduce((sum, i) => sum + (i.qty * i.price), 0);

  return {
    date: today,
    type: s.type,
    category: s.category,
    vendor: s.vendor,
    items: s.items,
    description: s.description,
    total
  };
}

function generateInsights() {
  const totalSales = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='sale'").get().v;
  const totalExpenses = db.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='expense'").get().v;
  const txCount = db.prepare('SELECT COUNT(*) as v FROM transactions').get().v;

  if (txCount < 2) {
    return [{
      type: 'info',
      key: 'need_more_data',
      en: 'Add more transactions to see meaningful business insights. At least 2 transactions are needed.',
      roman: 'Mazid transactions add karein taake aapke karobar ki behtar insights mil sakein. Kam az kam 2 transactions zaroori hain.',
      urdu: 'بامعنی کاروباری بصیرت کے لیے مزید لین دین شامل کریں۔ کم از کم 2 لین دین ضروری ہیں۔'
    }];
  }

  const insights = [];

  // 1. Profit/Loss status
  if (totalSales > totalExpenses) {
    const profit = totalSales - totalExpenses;
    insights.push({
      type: 'success', key: 'profit',
      en: `Your recorded sales exceed expenses by Rs. ${profit.toLocaleString()}. Your business is generating positive returns.`,
      roman: `Aapki recorded sales kharchon se Rs. ${profit.toLocaleString()} zyada hain. Aapka karobar acha munafa de raha hai.`,
      urdu: `آپ کی ریکارڈ شدہ فروخت اخراجات سے Rs. ${profit.toLocaleString()} زیادہ ہے۔ آپ کا کاروبار اچھا منافع دے رہا ہے۔`
    });
  } else if (totalExpenses > totalSales) {
    const loss = totalExpenses - totalSales;
    insights.push({
      type: 'warning', key: 'loss',
      en: `Your recorded expenses exceed sales by Rs. ${loss.toLocaleString()}. Review your spending categories.`,
      roman: `Aapke recorded kharchay sales se Rs. ${loss.toLocaleString()} zyada hain. Apne kharchon ka jaiza lein.`,
      urdu: `آپ کے ریکارڈ شدہ اخراجات فروخت سے Rs. ${loss.toLocaleString()} زیادہ ہیں۔ اپنے اخراجات کا جائزہ لیں۔`
    });
  }

  // 2. Top expense category
  const topCat = db.prepare("SELECT category, SUM(amount) as total FROM transactions WHERE type='expense' GROUP BY category ORDER BY total DESC LIMIT 1").get();
  if (topCat) {
    const pct = totalExpenses > 0 ? Math.round((topCat.total / totalExpenses) * 100) : 0;
    insights.push({
      type: 'info', key: 'top_expense',
      en: `"${topCat.category}" is your largest expense category, making up ${pct}% of total expenses (Rs. ${topCat.total.toLocaleString()}).`,
      roman: `"${topCat.category}" aapka sab se bada kharcha category hai, jo kul kharchon ka ${pct}% hai (Rs. ${topCat.total.toLocaleString()}).`,
      urdu: `"${topCat.category}" آپ کا سب سے بڑا خرچہ کیٹیگری ہے، جو کل اخراجات کا ${pct}% ہے (Rs. ${topCat.total.toLocaleString()})۔`
    });
  }

  // 3. Transaction count
  const saleCount = db.prepare("SELECT COUNT(*) as v FROM transactions WHERE type='sale'").get().v;
  const expenseCount = db.prepare("SELECT COUNT(*) as v FROM transactions WHERE type='expense'").get().v;
  insights.push({
    type: 'info', key: 'tx_summary',
    en: `You have ${saleCount} sale(s) and ${expenseCount} expense(s) recorded. Total ${txCount} transactions.`,
    roman: `Aapke paas ${saleCount} sale(s) aur ${expenseCount} expense(s) record hain. Kul ${txCount} transactions.`,
    urdu: `آپ کے پاس ${saleCount} فروخت اور ${expenseCount} اخراجات ریکارڈ ہیں۔ کل ${txCount} لین دین۔`
  });

  // 4. Average transaction
  const avgSale = saleCount > 0 ? Math.round(totalSales / saleCount) : 0;
  if (avgSale > 0) {
    insights.push({
      type: 'info', key: 'avg_sale',
      en: `Your average sale amount is Rs. ${avgSale.toLocaleString()}.`,
      roman: `Aapki average sale amount Rs. ${avgSale.toLocaleString()} hai.`,
      urdu: `آپ کی اوسط فروخت کی رقم Rs. ${avgSale.toLocaleString()} ہے۔`
    });
  }

  // 5. Monthly trend (if enough data)
  const months = db.prepare(`
    SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total
    FROM transactions GROUP BY month, type ORDER BY month DESC LIMIT 4
  `).all();

  if (months.length >= 4) {
    const recentSales = months.filter(m => m.type === 'sale').slice(0, 2);
    if (recentSales.length === 2 && recentSales[0].total > recentSales[1].total) {
      insights.push({
        type: 'success', key: 'sales_trend_up',
        en: 'Your sales have increased compared to the previous recorded period. Keep it up!',
        roman: 'Pichle record kiye gaye arsay ke muqablay mein aapki sales barh gayi hain. Jaari rakhein!',
        urdu: 'پچھلے ریکارڈ کیے گئے عرصے کے مقابلے میں آپ کی فروخت میں اضافہ ہوا ہے۔ جاری رکھیں!'
      });
    } else if (recentSales.length === 2 && recentSales[0].total < recentSales[1].total) {
      insights.push({
        type: 'warning', key: 'sales_trend_down',
        en: 'Your sales decreased compared to the previous recorded period. Consider reviewing your strategy.',
        roman: 'Pichle record kiye gaye arsay ke muqablay mein aapki sales kam ho gayi hain. Apni strategy ka jaiza lein.',
        urdu: 'پچھلے ریکارڈ کیے گئے عرصے کے مقابلے میں آپ کی فروخت میں کمی ہوئی ہے۔ اپنی حکمت عملی کا جائزہ لیں۔'
      });
    }
  }

  return insights;
}

function seedDemoData() {
  const count = db.prepare('SELECT COUNT(*) as v FROM transactions').get().v;
  if (count > 0) return; // Don't re-seed

  const now = new Date();
  const transactions = [];

  // Generate 30 days of realistic Pakistani small-business data
  const saleCategories = ['Daily Sales', 'Wholesale', 'Online Order'];
  const expenseItems = [
    { cat: 'Inventory', desc: 'Atta (Flour) restock', items: [{ name: 'Atta 10kg', qty: 5, price: 1800 }], vendor: 'Al-Madina Wholesale' },
    { cat: 'Inventory', desc: 'Cheeni & Ghee restock', items: [{ name: 'Cheeni 5kg', qty: 4, price: 850 }, { name: 'Ghee 5kg', qty: 3, price: 2400 }], vendor: 'Karachi Wholesale Market' },
    { cat: 'Inventory', desc: 'Cooking oil & spices', items: [{ name: 'Cooking Oil 5L', qty: 3, price: 2200 }, { name: 'Masala Pack', qty: 10, price: 120 }], vendor: 'Shah Traders' },
    { cat: 'Utilities', desc: 'Electricity bill', items: [{ name: 'LESCO Bill', qty: 1, price: 5200 }], vendor: 'LESCO' },
    { cat: 'Utilities', desc: 'Gas bill', items: [{ name: 'SNGPL Bill', qty: 1, price: 2800 }], vendor: 'SNGPL' },
    { cat: 'Rent', desc: 'Shop rent', items: [{ name: 'Monthly Rent', qty: 1, price: 15000 }], vendor: '' },
    { cat: 'Delivery', desc: 'Delivery charges', items: [{ name: 'Bykea Delivery', qty: 3, price: 250 }], vendor: 'Bykea' },
    { cat: 'Packaging', desc: 'Packaging material', items: [{ name: 'Plastic Bags 1kg', qty: 5, price: 350 }, { name: 'Paper Bags', qty: 100, price: 8 }], vendor: 'Pakistan Packaging' },
    { cat: 'Transport', desc: 'Rickshaw fare for goods', items: [{ name: 'Rickshaw Transport', qty: 1, price: 600 }], vendor: '' },
    { cat: 'Staff Salary', desc: 'Helper salary', items: [{ name: 'Part-time Helper', qty: 1, price: 8000 }], vendor: '' }
  ];

  // Add sales for the past 30 days
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];

    // 80% chance of a sale each day
    if (Math.random() < 0.8) {
      const cat = saleCategories[Math.floor(Math.random() * saleCategories.length)];
      const amount = Math.round((3000 + Math.random() * 12000) / 100) * 100;
      transactions.push({
        id: uuidv4(), date: dateStr, type: 'sale', category: cat,
        amount, description: `${cat} - Day ${30 - i}`,
        items: JSON.stringify([{ name: cat, qty: 1, price: amount }]),
        source: 'seed_demo', receipt_url: '', vendor: ''
      });
    }

    // Expenses — 2-3 per week
    if (i % 3 === 0 || i % 7 === 0) {
      const exp = expenseItems[Math.floor(Math.random() * expenseItems.length)];
      const total = exp.items.reduce((s, it) => s + it.qty * it.price, 0);
      transactions.push({
        id: uuidv4(), date: dateStr, type: 'expense', category: exp.cat,
        amount: total, description: exp.desc,
        items: JSON.stringify(exp.items),
        source: 'seed_demo', receipt_url: '', vendor: exp.vendor
      });
    }
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions (id, date, type, category, amount, description, items, source, receipt_url, vendor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    for (const t of transactions) {
      insert.run(t.id, t.date, t.type, t.category, t.amount, t.description, t.items, t.source, t.receipt_url, t.vendor);
    }
  });
  txn();
}

// ══════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════
seedDemoData(); // Auto-seed if empty

app.listen(PORT, () => {
  console.log(`\n  KarobarSaathi AI Server`);
  console.log(`  ─────────────────────────`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  API:     http://localhost:${PORT}/api`);
  console.log(`  Mode:    ${isProd ? 'Production' : 'Development'}\n`);
});
