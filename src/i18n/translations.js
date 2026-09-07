// ── i18n translations ──────────────────────────────────
// Three languages: English (en), Roman Urdu (roman), Urdu (ur)

const translations = {
  // ── Brand ──────────────────────────────────────────────
  brand_name: { en: 'KarobarSaathi AI', roman: 'KarobarSaathi AI', ur: 'کاروبار ساتھی AI' },
  tagline: {
    en: 'Apna Hisaab Samjho. Apna Karobar Barhao.',
    roman: 'Apna Hisaab Samjho. Apna Karobar Barhao.',
    ur: 'اپنا حساب سمجھو۔ اپنا کاروبار بڑھاؤ۔'
  },
  tagline_sub: {
    en: 'AI-powered financial assistant for small businesses in Pakistan',
    roman: 'Pakistan ke chotay karobaron ke liye AI-powered financial assistant',
    ur: 'پاکستان کے چھوٹے کاروباروں کے لیے AI سے چلنے والا مالی معاون'
  },

  // ── Navigation ─────────────────────────────────────────
  nav_dashboard: { en: 'Dashboard', roman: 'Dashboard', ur: 'ڈیش بورڈ' },
  nav_transactions: { en: 'Transactions', roman: 'Transactions', ur: 'لین دین' },
  nav_insights: { en: 'Insights', roman: 'Insights', ur: 'بصیرت' },
  nav_scan: { en: 'Scan Receipt', roman: 'Receipt Scan', ur: 'رسید اسکین' },

  // ── Landing ────────────────────────────────────────────
  landing_hero_title: {
    en: 'Your AI Business Companion',
    roman: 'Aapka AI Karobari Saathi',
    ur: 'آپ کا AI کاروباری ساتھی'
  },
  landing_hero_desc: {
    en: 'Scan receipts, track sales & expenses, and get AI-powered insights to grow your business. Built for Pakistani shopkeepers and home-based businesses.',
    roman: 'Receipts scan karein, sales aur expenses track karein, aur AI-powered insights se apna karobar barhayein. Pakistani dukandaron aur ghar ke karobaron ke liye.',
    ur: 'رسیدیں اسکین کریں، فروخت اور اخراجات کو ٹریک کریں، اور AI سے چلنے والی بصیرت سے اپنا کاروبار بڑھائیں۔ پاکستانی دکانداروں اور گھریلو کاروباروں کے لیے۔'
  },
  landing_cta: { en: 'Get Started', roman: 'Shuru Karein', ur: 'شروع کریں' },
  landing_scan_title: { en: 'Scan Receipts', roman: 'Receipts Scan', ur: 'رسیدیں اسکین' },
  landing_scan_desc: {
    en: 'Upload any receipt and our AI extracts transaction details automatically.',
    roman: 'Koi bhi receipt upload karein aur AI khud-ba-khud transaction details nikalta hai.',
    ur: 'کوئی بھی رسید اپ لوڈ کریں اور AI خود بخود لین دین کی تفصیلات نکالتا ہے۔'
  },
  landing_track_title: { en: 'Track Hisaab', roman: 'Hisaab Track', ur: 'حساب ٹریک' },
  landing_track_desc: {
    en: 'Keep a complete digital record of all your sales and expenses in one place.',
    roman: 'Apni tamam sales aur expenses ka mukammal digital record ek jagah rakhein.',
    ur: 'اپنی تمام فروخت اور اخراجات کا مکمل ڈیجیٹل ریکارڈ ایک جگہ رکھیں۔'
  },
  landing_insights_title: { en: 'AI Insights', roman: 'AI Insights', ur: 'AI بصیرت' },
  landing_insights_desc: {
    en: 'Get practical business insights based on your actual transaction data.',
    roman: 'Apne actual transaction data ki bunyad par practical business insights paayein.',
    ur: 'اپنے اصل لین دین کے ڈیٹا کی بنیاد پر عملی کاروباری بصیرت حاصل کریں۔'
  },
  landing_demo_note: {
    en: 'Sample demo data is pre-loaded so you can explore the dashboard and insights immediately.',
    roman: 'Sample demo data pehle se loaded hai taake aap foran dashboard aur insights explore kar sakein.',
    ur: 'نمونہ ڈیمو ڈیٹا پہلے سے لوڈ ہے تاکہ آپ فوری طور پر ڈیش بورڈ اور بصیرت دریافت کر سکیں۔'
  },

  // ── Dashboard ──────────────────────────────────────────
  dash_title: { en: 'Business Dashboard', roman: 'Karobar Dashboard', ur: 'کاروبار ڈیش بورڈ' },
  dash_total_sales: { en: 'Total Sales', roman: 'Kul Sales', ur: 'کل فروخت' },
  dash_total_expenses: { en: 'Total Expenses', roman: 'Kul Kharchay', ur: 'کل اخراجات' },
  dash_profit: { en: 'Estimated Profit', roman: 'Takhmini Munafa', ur: 'تخمینی منافع' },
  dash_loss: { en: 'Net Loss', roman: 'Nuqsan', ur: 'نقصان' },
  dash_transactions: { en: 'Transactions', roman: 'Transactions', ur: 'لین دین' },
  dash_sales_vs_expenses: { en: 'Sales vs Expenses', roman: 'Sales vs Kharchay', ur: 'فروخت بمقابلہ اخراجات' },
  dash_expense_categories: { en: 'Expense Categories', roman: 'Kharcha Categories', ur: 'خرچہ کیٹیگریز' },
  dash_recent: { en: 'Recent Transactions', roman: 'Haaliya Transactions', ur: 'حالیہ لین دین' },
  dash_demo_label: { en: 'Demo Data', roman: 'Demo Data', ur: 'ڈیمو ڈیٹا' },
  dash_no_data: {
    en: 'No transactions yet. Scan a receipt or add a transaction to get started.',
    roman: 'Abhi koi transaction nahi. Receipt scan karein ya transaction add karein.',
    ur: 'ابھی کوئی لین دین نہیں۔ رسید اسکین کریں یا لین دین شامل کریں۔'
  },
  dash_monthly: { en: 'Monthly', roman: 'Maahana', ur: 'ماہانہ' },

  // ── Receipt ────────────────────────────────────────────
  receipt_title: { en: 'Scan Receipt', roman: 'Receipt Scan Karein', ur: 'رسید اسکین کریں' },
  step_upload: { en: 'Upload', roman: 'Upload', ur: 'اپ لوڈ' },
  step_process: { en: 'Process', roman: 'Process', ur: 'پروسیس' },
  step_review: { en: 'Review', roman: 'Review', ur: 'جائزہ' },
  step_save: { en: 'Save', roman: 'Save', ur: 'محفوظ' },
  step_speak: { en: 'Speak', roman: 'Bolein', ur: 'بولیں' },
  step_transcript: { en: 'Transcript', roman: 'Transcript', ur: 'ٹرانسکرپٹ' },
  receipt_raw_ocr_failed: { en: 'Raw OCR text from the failed attempt', roman: 'Naakaam koshish ka raw OCR text', ur: 'ناکام کوشش کا خام OCR متن' },
  receipt_upload: { en: 'Upload Receipt Image', roman: 'Receipt Image Upload Karein', ur: 'رسید کی تصویر اپ لوڈ کریں' },
  receipt_drag: {
    en: 'Drag & drop a receipt image or click to browse',
    roman: 'Receipt image drag & drop karein ya click karke browse karein',
    ur: 'رسید کی تصویر ڈریگ اینڈ ڈراپ کریں یا کلک کرکے براؤز کریں'
  },
  receipt_formats: { en: 'Supports JPG, PNG, WebP (max 10MB)', roman: 'JPG, PNG, WebP (max 10MB)', ur: 'JPG, PNG, WebP (زیادہ سے زیادہ 10MB)' },
  receipt_processing: { en: 'Processing Receipt...', roman: 'Receipt Process Ho Rahi Hai...', ur: 'رسید پروسیس ہو رہی ہے...' },
  receipt_ai_reading: { en: 'Reading text from your receipt image with OCR...', roman: 'OCR se aapki receipt parh raha hai...', ur: 'OCR سے آپ کی رسید پڑھ رہا ہے...' },
  receipt_ocr_mode: { en: 'Receipt processed with OCR', roman: 'Receipt OCR se process hui', ur: 'رسید OCR سے پروسیس ہوئی' },
  receipt_ocr_confidence: { en: 'confidence', roman: 'confidence', ur: 'اعتماد' },
  receipt_ocr_review: { en: 'Review the extracted data below and correct any errors before saving.', roman: 'Nikala gaya data check karein aur ghalatiyan durust karein.', ur: 'نکالا گیا ڈیٹا چیک کریں اور غلطیاں درست کریں۔' },
  receipt_low_confidence: { en: 'Some fields may need correction', roman: 'Kuch fields theek karni parh sakti hain', ur: 'کچھ فیلڈز ٹھیک کرنی پڑ سکتی ہیں' },
  receipt_raw_text: { en: 'Raw extracted text (OCR output)', roman: 'Raw nikala gaya text (OCR output)', ur: 'خام نکالا گیا متن (OCR آؤٹ پٹ)' },
  receipt_extracted: { en: 'Extracted Information', roman: 'Nikali Gayi Maloomat', ur: 'نکالی گئی معلومات' },
  receipt_review: {
    en: 'Review and correct the extracted data before saving.',
    roman: 'Save karne se pehle nikali gayi data ka jaiza lein aur durust karein.',
    ur: 'محفوظ کرنے سے پہلے نکالے گئے ڈیٹا کا جائزہ لیں اور درست کریں۔'
  },
  receipt_demo_mode: {
    en: 'Demo Mode — Connect an AI provider for real receipt scanning.',
    roman: 'Demo Mode — Asli receipt scanning ke liye AI provider connect karein.',
    ur: 'ڈیمو موڈ — حقیقی رسید اسکیننگ کے لیے AI فراہم کنندہ سے جوڑیں۔'
  },
  receipt_confirm_save: { en: 'Confirm & Save', roman: 'Confirm Aur Save', ur: 'تصدیق اور محفوظ' },
  receipt_cancel: { en: 'Cancel', roman: 'Cancel', ur: 'منسوخ' },
  receipt_scan_new: { en: 'Scan Another', roman: 'Ek Aur Scan', ur: 'ایک اور اسکین' },
  receipt_saved: { en: 'Transaction saved successfully!', roman: 'Transaction kamyabi se save ho gaya!', ur: 'لین دین کامیابی سے محفوظ ہو گیا!' },
  receipt_saved_desc: { en: 'Your transaction has been saved and the dashboard has been updated.', roman: 'Aapka transaction save ho gaya aur dashboard update ho gaya hai.', ur: 'آپ کا لین دین محفوظ ہو گیا اور ڈیش بورڈ اپ ڈیٹ ہو گیا ہے۔' },
  receipt_process_btn: { en: 'Process Receipt', roman: 'Receipt Process Karein', ur: 'رسید پروسیس کریں' },
  receipt_ai_vision_mode: { en: 'Processed with AI Vision', roman: 'AI Vision se process hui', ur: 'AI Vision سے پروسیس ہوئی' },
  receipt_ai_vision_desc: { en: 'The local OCR could not read this receipt clearly, so a cloud AI model analyzed the image. Please verify the data below.', roman: 'Local OCR is receipt ko theek se nahi parh saka, is liye cloud AI ne image ka tajziya kiya. Neechay data ki tasdeeq karein.', ur: 'مقامی OCR اس رسید کو صحیح طور پر نہیں پڑھ سکا، اس لیے کلاؤڈ AI نے تصویر کا تجزیہ کیا۔ نیچے ڈیٹا کی تصدیق کریں۔' },
  receipt_total_label: { en: 'Total', roman: 'Kul', ur: 'کل' },
  receipt_payment_label: { en: 'Payment', roman: 'Payment', ur: 'ادائیگی' },
  receipt_type_sale: { en: 'Sale', roman: 'Sale', ur: 'فروخت' },
  receipt_type_expense: { en: 'Expense', roman: 'Kharcha', ur: 'خرچہ' },

  // ── Multi-receipt ───────────────────────────────────────
  multi_detected_title: { en: 'receipts detected', roman: 'receipts mil gaye', ur: 'رسیدیں مل گئیں' },
  multi_detected_desc: { en: 'We found multiple receipts in your image. Review and edit each one below, then save all.', roman: 'Aapki image mein multiple receipts mile hain. Har ek ko neechay review aur edit karein, phir sab save karein.', ur: 'آپ کی تصویر میں متعدد رسیدیں ملی ہیں۔ ہر ایک کو نیچے جانچیں اور ترمیم کریں، پھر سب محفوظ کریں۔' },
  multi_save_all: { en: 'Save All', roman: 'Sab Save Karein', ur: 'سب محفوظ کریں' },
  multi_saving: { en: 'Saving...', roman: 'Save ho raha hai...', ur: 'محفوظ ہو رہا ہے...' },
  multi_saved_success: { en: 'All receipts saved successfully!', roman: 'Sab receipts kamyabi se save ho gaye!', ur: 'تمام رسیدیں کامیابی سے محفوظ ہو گئیں!' },
  multi_remove: { en: 'Remove', roman: 'Hatayein', ur: 'ہٹائیں' },
  multi_receipt_number: { en: 'Receipt', roman: 'Receipt', ur: 'رسید' },


  // ── Transaction ────────────────────────────────────────
  tx_title: { en: 'Transaction History', roman: 'Transaction Tareekh', ur: 'لین دین کی تاریخ' },
  tx_add: { en: 'Add Transaction', roman: 'Transaction Add', ur: 'لین دین شامل' },
  tx_filter_all: { en: 'All', roman: 'Sab', ur: 'سب' },
  tx_filter_sales: { en: 'Sales', roman: 'Sales', ur: 'فروخت' },
  tx_filter_expenses: { en: 'Expenses', roman: 'Kharchay', ur: 'اخراجات' },
  tx_empty: {
    en: 'No transactions recorded yet.',
    roman: 'Abhi koi transaction record nahi hua.',
    ur: 'ابھی کوئی لین دین ریکارڈ نہیں ہوا۔'
  },
  tx_delete_confirm: {
    en: 'Are you sure you want to delete this transaction?',
    roman: 'Kya aap waqai ye transaction delete karna chahte hain?',
    ur: 'کیا آپ واقعی یہ لین دین حذف کرنا چاہتے ہیں؟'
  },
  tx_source_receipt: { en: 'Receipt', roman: 'Receipt', ur: 'رسید' },
  tx_source_manual: { en: 'Manual', roman: 'Manual', ur: 'دستی' },
  tx_source_seed: { en: 'Demo', roman: 'Demo', ur: 'ڈیمو' },
  tx_source_voice: { en: 'Voice', roman: 'Voice', ur: 'آواز' },
  tx_edit: { en: 'Edit', roman: 'Edit', ur: 'ترمیم' },
  tx_delete: { en: 'Delete', roman: 'Delete', ur: 'حذف' },
  tx_save: { en: 'Save Changes', roman: 'Tabdeeli Save', ur: 'تبدیلی محفوظ' },
  edit_select: { en: 'Select...', roman: 'Muntakhab karein...', ur: 'منتخب کریں...' },
  edit_custom: { en: 'Custom...', roman: 'Custom...', ur: 'اپنی مرضی...' },

  // ── Manual Entry ───────────────────────────────────────
  manual_title: { en: 'Add Transaction', roman: 'Transaction Add Karein', ur: 'لین دین شامل کریں' },
  manual_type: { en: 'Type', roman: 'Type', ur: 'قسم' },
  manual_date: { en: 'Date', roman: 'Tareekh', ur: 'تاریخ' },
  manual_category: { en: 'Category', roman: 'Category', ur: 'کیٹیگری' },
  manual_amount: { en: 'Amount (Rs.)', roman: 'Amount (Rs.)', ur: 'رقم (Rs.)' },
  manual_description: { en: 'Description', roman: 'Tafseel', ur: 'تفصیل' },
  manual_vendor: { en: 'Vendor / Merchant', roman: 'Vendor / Dukaandaar', ur: 'ویپر / دکاندار' },
  manual_items: { en: 'Items', roman: 'Items', ur: 'اشیاء' },
  manual_add_item: { en: '+ Add Item', roman: '+ Item Add', ur: '+ شے شامل' },
  manual_submit: { en: 'Save Transaction', roman: 'Transaction Save', ur: 'لین دین محفوظ' },
  manual_success: { en: 'Transaction added successfully!', roman: 'Transaction kamyabi se add ho gaya!', ur: 'لین دین کامیابی سے شامل ہو گیا!' },
  manual_item_name: { en: 'Item name', roman: 'Item ka naam', ur: 'شے کا نام' },
  manual_item_qty: { en: 'Qty', roman: 'Tadaad', ur: 'تعداد' },
  manual_item_price: { en: 'Price', roman: 'Qeemat', ur: 'قیمت' },
  manual_select_category: { en: 'Select category...', roman: 'Category muntakhab karein...', ur: 'کیٹیگری منتخب کریں...' },
  manual_optional: { en: 'Optional', roman: 'Ikhtiari', ur: 'اختیاری' },
  manual_desc_placeholder: { en: 'Brief description', roman: 'Mukhtasir tafseel', ur: 'مختصر تفصیل' },
  manual_items_total: { en: 'Items total', roman: 'Items ka kul', ur: 'اشیاء کا کل' },
  receipt_try_again: { en: 'Try Again', roman: 'Dobara Koshish', ur: 'دوبارہ کوشش' },

  // ── Insights ───────────────────────────────────────────
  insights_title: { en: 'Business Insights', roman: 'Karobari Insights', ur: 'کاروباری بصیرت' },
  insights_desc: {
    en: 'AI-generated insights based on your recorded transactions.',
    roman: 'Aapke record kiye gaye transactions par mabni AI insights.',
    ur: 'آپ کے ریکارڈ کیے گئے لین دین پر مبنی AI بصیرت۔'
  },
  insights_empty: {
    en: 'Not enough data for insights. Add more transactions to see meaningful analysis.',
    roman: 'Insights ke liye kaafi data nahi hai. Mazid transactions add karein.',
    ur: 'بصیرت کے لیے کافی ڈیٹا نہیں ہے۔ مزید لین دین شامل کریں۔'
  },
  insights_data_driven: {
    en: 'All insights are calculated from your actual recorded data.',
    roman: 'Tamam insights aapke actual record kiye gaye data se calculate kiye gaye hain.',
    ur: 'تمام بصیرت آپ کے اصل ریکارڈ کیے گئے ڈیٹا سے حساب کی گئی ہیں۔'
  },

  // ── Common ─────────────────────────────────────────────
  common_loading: { en: 'Loading...', roman: 'Loading...', ur: 'لوڈ ہو رہا ہے...' },
  common_error: { en: 'Something went wrong. Please try again.', roman: 'Kuch ghalat ho gaya. Dobara koshish karein.', ur: 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔' },
  common_rs: { en: 'Rs.', roman: 'Rs.', ur: 'Rs.' },
  common_or: { en: 'or', roman: 'ya', ur: 'یا' },
  common_back: { en: 'Back', roman: 'Wapis', ur: 'واپس' },
  language: { en: 'Language', roman: 'Zaban', ur: 'زبان' },

  // ── Voice Entry ─────────────────────────────────────
  nav_voice: { en: 'Voice Entry', roman: 'Voice Entry', ur: 'آواز اندراج' },
  voice_title: { en: 'Voice Entry', roman: 'Voice Se Entry', ur: 'آواز سے اندراج' },
  voice_unsupported: {
    en: 'Speech Recognition Not Available',
    roman: 'Speech Recognition Available Nahi Hai',
    ur: 'اسپیچ ریکگنیشن دستیاب نہیں'
  },
  voice_unsupported_desc: {
    en: 'Your browser does not support speech recognition. Please use Manual Entry or Scan Receipt instead. Chrome and Edge offer the best support.',
    roman: 'Aapka browser speech recognition support nahi karta. Manual Entry ya Scan Receipt use karein. Chrome aur Edge mein behtar support hai.',
    ur: 'آپ کا براؤزر اسپیچ ریکگنیشن کو سپورٹ نہیں کرتا۔ براہ کرم مینول اندراج یا رسید اسکین استعمال کریں۔'
  },
  voice_instruction: {
    en: 'Tap the microphone and speak your transaction naturally in English or Roman Urdu.',
    roman: 'Mic dabayein aur apna transaction English ya Roman Urdu mein bole.',
    ur: 'مائیک دبائیں اور اپنا لین دین انگریزی یا رومن اردو میں بولیں۔'
  },
  voice_click_mic: {
    en: 'Tap to start recording',
    roman: 'Recording shuru karne ke liye dabayein',
    ur: 'ریکارڈنگ شروع کرنے کے لیے دبائیں'
  },
  voice_listening: {
    en: 'Listening... Speak now',
    roman: 'Sun raha hoon... Bolein',
    ur: 'سن رہا ہوں... بولیں'
  },
  voice_tap_stop: {
    en: 'Tap the red button to stop',
    roman: 'Roknay ke liye laal button dabayein',
    ur: 'روکنے کے لیے لال بٹن دبائیں'
  },
  voice_transcript_title: {
    en: 'What you said',
    roman: 'Aapne kya kaha',
    ur: 'آپ نے کیا کہا'
  },
  voice_no_amount: {
    en: 'Could not detect an amount in your speech. Please enter it manually.',
    roman: 'Aapki baat mein amount detect nahi hua. Manual enter karein.',
    ur: 'آپ کی بات میں رقم کا پتہ نہیں چلا۔ براہ کرم دستی درج کریں۔'
  },
  voice_try_again: {
    en: 'Try Again',
    roman: 'Dobara Koshish',
    ur: 'دوبارہ کوشش'
  },
  voice_badge_label: {
    en: 'Captured via Voice Input',
    roman: 'Voice Input se pakra gaya',
    ur: 'آواز ان پٹ سے پکڑا گیا'
  },
  voice_review_hint: {
    en: 'Your speech was converted to text and parsed automatically. Please review and correct before saving.',
    roman: 'Aapki baat text mein tabdeel ho gayi. Save se pehle check karein.',
    ur: 'آپ کی بات متن میں تبدیل ہو گئی۔ محفوظ کرنے سے پہلے چیک کریں۔'
  },
  voice_type_confirm: {
    en: 'Transaction type needs your confirmation',
    roman: 'Transaction type ki tasdeeq karein',
    ur: 'لین دین کی قسم کی تصدیق کریں'
  },
  voice_type_confirm_desc: {
    en: 'Your speech does not clearly indicate whether this is a Sale or an Expense. Please choose one.',
    roman: 'Aapki baat se Sale ya Expense clear nahi hai. Ek chunein.',
    ur: 'آپ کی بات سے فروخت یا خرچہ واضح نہیں ہے۔ ایک منتخب کریں۔'
  },
  voice_review_title: {
    en: 'Review & Save',
    roman: 'Check Aur Save',
    ur: 'چیک اور محفوظ'
  },
  voice_saved_desc: {
    en: 'Your voice transaction has been saved and the dashboard updated.',
    roman: 'Aapka voice transaction save ho gaya aur dashboard update ho gaya.',
    ur: 'آپ کا آواز لین دین محفوظ ہو گیا اور ڈیش بورڈ اپ ڈیٹ ہو گیا۔'
  },
  voice_record_another: {
    en: 'Record Another',
    roman: 'Ek Aur Record',
    ur: 'ایک اور ریکارڈ'
  },
  voice_tips_title: {
    en: 'Examples you can try',
    roman: 'Kuch misalein',
    ur: 'کچھ مثالیں'
  },
  voice_example_sale: {
    en: 'Aaj 5000 ki sale hui',
    roman: 'Aaj 5000 ki sale hui',
    ur: 'آج 5000 کی سیل ہوئی'
  },
  voice_example_expense: {
    en: 'Aaj 2000 ka maal khareeda',
    roman: 'Aaj 2000 ka maal khareeda',
    ur: 'آج 2000 کا مال خریدا'
  },
  voice_example_ambiguous: {
    en: 'City Mini Mart se 680 rupay ka sauda',
    roman: 'City Mini Mart se 680 rupay ka sauda',
    ur: 'سٹی منی مارٹ سے 680 روپے کا سودا'
  },
};

export default translations;
