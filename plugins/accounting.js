/**
 * Accounting Plugin — Xero Integration
 */
let config = {};

module.exports = {
  name: 'accounting',
  version: '1.0.0',
  description: 'Xero accounting: invoices, expenses, P&L, tax tracking',
  requiredKeys: ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'],
  commands: ['/xero_invoices', '/xero_pnl', '/xero_expenses'],
  tools: [
    {
      type: 'function', function: {
        name: 'xero_profit_loss',
        description: 'Get profit and loss report from Xero',
        parameters: { type: 'object', properties: {
          fromDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          toDate: { type: 'string', description: 'End date (YYYY-MM-DD)' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'xero_invoices',
        description: 'List recent invoices from Xero',
        parameters: { type: 'object', properties: {
          status: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID'], description: 'Filter by status' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'xero_create_expense',
        description: 'Record an expense in Xero',
        parameters: { type: 'object', properties: {
          description: { type: 'string', description: 'Expense description' },
          amount: { type: 'number', description: 'Amount' },
          category: { type: 'string', description: 'Expense category (e.g., Software, Tools, Materials)' },
          date: { type: 'string', description: 'Date (YYYY-MM-DD)' }
        }, required: ['description', 'amount'] }
      }
    }
  ],

  init(deps) { config = deps.config; },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'xero_profit_loss': return await profitLoss(args);
      case 'xero_invoices': return await listInvoices(args.status);
      case 'xero_create_expense': return await createExpense(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function getXeroToken() {
  const auth = Buffer.from(`${config.XERO_CLIENT_ID}:${config.XERO_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=accounting.transactions accounting.reports.read'
  });
  const data = await res.json();
  return data.access_token;
}

async function xeroRequest(endpoint, method = 'GET', body = null) {
  const token = await getXeroToken();
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'xero-tenant-id': config.XERO_TENANT_ID,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(15000)
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.xero.com/api.xro/2.0${endpoint}`, opts);
  if (!res.ok) throw new Error(`Xero ${res.status}: ${await res.text()}`);
  return res.json();
}

async function profitLoss(args) {
  try {
    const from = args.fromDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const to = args.toDate || new Date().toISOString().split('T')[0];
    const data = await xeroRequest(`/Reports/ProfitAndLoss?fromDate=${from}&toDate=${to}`);
    return { success: true, source: 'Xero API (REAL DATA)', report: data.Reports?.[0] };
  } catch (e) { return { success: false, error: e.message }; }
}

async function listInvoices(status = null) {
  try {
    let url = '/Invoices?order=Date DESC&page=1';
    if (status) url += `&Statuses=${status}`;
    const data = await xeroRequest(url);
    return {
      success: true, source: 'Xero API (REAL DATA)',
      invoices: (data.Invoices || []).slice(0, 20).map(i => ({
        id: i.InvoiceID, number: i.InvoiceNumber, contact: i.Contact?.Name,
        total: i.Total, status: i.Status, date: i.DateString, due: i.DueDateString
      }))
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function createExpense(args) {
  try {
    const data = await xeroRequest('/BankTransactions', 'POST', {
      BankTransactions: [{
        Type: 'SPEND',
        Contact: { Name: args.category || 'General Expense' },
        LineItems: [{ Description: args.description, UnitAmount: args.amount, AccountCode: '400' }],
        BankAccount: { Code: '090' },
        Date: args.date || new Date().toISOString().split('T')[0]
      }]
    });
    return { success: true, id: data.BankTransactions?.[0]?.BankTransactionID };
  } catch (e) { return { success: false, error: e.message }; }
}
