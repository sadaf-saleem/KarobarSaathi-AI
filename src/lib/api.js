const BASE = '/api';

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${url}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
  } catch {
    throw new Error('Unable to reach the server. Please check your internet connection.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  // Dashboard
  getDashboard: () => request('/dashboard'),

  // Transactions
  getTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/transactions${qs ? '?' + qs : ''}`);
  },
  getTransaction: (id) => request(`/transactions/${id}`),
  createTransaction: (data) => request('/transactions', { method: 'POST', body: JSON.stringify(data) }),
  updateTransaction: (id, data) => request(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTransaction: (id) => request(`/transactions/${id}`, { method: 'DELETE' }),

  // Receipt
  processReceipt: async (file) => {
    const formData = new FormData();
    formData.append('receipt', file);

    // 3-minute timeout — receipt processing can be slow (OCR + AI Vision)
    // but should never take longer than this.
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 180_000);

    let res;
    try {
      res = await fetch(`${BASE}/receipt/process`, {
        method: 'POST',
        body: formData,
        signal: ctrl.signal
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Processing is taking too long. Please try a clearer, well-lit photo of your receipt.');
      }
      throw new Error('Unable to reach the server. Please check your internet connection.');
    }
    clearTimeout(timeout);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const error = new Error(err.error || 'Receipt processing failed');
      error.mode = err.mode;
      error.receiptUrl = err.receipt_url;
      error.rawText = err.rawText || '';
      error.source = err.source || '';
      throw error;
    }
    return res.json();
  },

  // Insights
  getInsights: () => request('/insights'),

  // Categories
  getCategories: () => request('/categories'),

  // Seed
  seedDemo: () => request('/seed', { method: 'POST' })
};
