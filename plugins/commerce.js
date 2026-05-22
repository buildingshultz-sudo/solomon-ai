/**
 * Commerce Plugin — Gumroad, PayPal
 */
let config = {};

module.exports = {
  name: 'commerce',
  version: '1.0.0',
  description: 'Digital commerce: Gumroad product management, PayPal payments',
  requiredKeys: [],
  commands: ['/gumroad_sales', '/paypal_balance'],
  tools: [
    {
      type: 'function', function: {
        name: 'gumroad_products',
        description: 'List all Gumroad products with sales data',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'gumroad_sales',
        description: 'Get recent Gumroad sales',
        parameters: { type: 'object', properties: {
          after: { type: 'string', description: 'Date filter (YYYY-MM-DD)' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'paypal_balance',
        description: 'Get PayPal account balance',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'paypal_transactions',
        description: 'Get recent PayPal transactions',
        parameters: { type: 'object', properties: {
          days: { type: 'number', description: 'Number of days to look back (default 30)' }
        }, required: [] }
      }
    }
  ],

  init(deps) { config = deps.config; },
  get _active() { return !!(config.GUMROAD_ACCESS_TOKEN || config.PAYPAL_CLIENT_ID); },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'gumroad_products': return await gumroadProducts();
      case 'gumroad_sales': return await gumroadSales(args.after);
      case 'paypal_balance': return await paypalBalance();
      case 'paypal_transactions': return await paypalTransactions(args.days || 30);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function gumroadProducts() {
  if (!config.GUMROAD_ACCESS_TOKEN) return { success: false, error: 'Gumroad token not configured' };
  try {
    const res = await fetch(`https://api.gumroad.com/v2/products?access_token=${config.GUMROAD_ACCESS_TOKEN}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Gumroad API error');
    return {
      success: true, source: 'Gumroad API (REAL DATA)',
      products: data.products.map(p => ({
        id: p.id, name: p.name, price: p.price, sales_count: p.sales_count,
        revenue: p.revenue, url: p.short_url, published: p.published
      }))
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function gumroadSales(after = null) {
  if (!config.GUMROAD_ACCESS_TOKEN) return { success: false, error: 'Gumroad token not configured' };
  try {
    let url = `https://api.gumroad.com/v2/sales?access_token=${config.GUMROAD_ACCESS_TOKEN}`;
    if (after) url += `&after=${after}`;
    const res = await fetch(url);
    const data = await res.json();
    return {
      success: true, source: 'Gumroad API (REAL DATA)',
      sales: (data.sales || []).map(s => ({
        id: s.id, product: s.product_name, email: s.email,
        price: s.price, created: s.created_at
      }))
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getPayPalToken() {
  const auth = Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const base = config.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return { token: data.access_token, base };
}

async function paypalBalance() {
  if (!config.PAYPAL_CLIENT_ID) return { success: false, error: 'PayPal not configured' };
  try {
    const { token, base } = await getPayPalToken();
    const res = await fetch(`${base}/v1/reporting/balances`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    return { success: true, source: 'PayPal API (REAL DATA)', balances: data.balances };
  } catch (e) { return { success: false, error: e.message }; }
}

async function paypalTransactions(days = 30) {
  if (!config.PAYPAL_CLIENT_ID) return { success: false, error: 'PayPal not configured' };
  try {
    const { token, base } = await getPayPalToken();
    const start = new Date(Date.now() - days * 86400000).toISOString();
    const end = new Date().toISOString();
    const res = await fetch(`${base}/v1/reporting/transactions?start_date=${start}&end_date=${end}&fields=all`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return {
      success: true, source: 'PayPal API (REAL DATA)',
      transactions: (data.transaction_details || []).slice(0, 20).map(t => ({
        id: t.transaction_info?.transaction_id,
        amount: t.transaction_info?.transaction_amount,
        status: t.transaction_info?.transaction_status,
        date: t.transaction_info?.transaction_initiation_date
      }))
    };
  } catch (e) { return { success: false, error: e.message }; }
}
