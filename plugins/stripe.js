/**
 * Stripe Plugin — Payments, Subscriptions, Invoicing, Customer Management
 */
let stripeKey = '';
const BASE_URL = 'https://api.stripe.com/v1';

module.exports = {
  name: 'stripe',
  version: '1.0.0',
  description: 'Stripe: payments, subscriptions, invoicing, customer management for IronEdit and products',
  requiredKeys: ['STRIPE_SECRET_KEY'],
  commands: ['/stripe_balance', '/stripe_charges', '/stripe_link', '/stripe_customers'],
  tools: [
    {
      type: 'function',
      function: {
        name: 'stripe_balance',
        description: 'Get current Stripe account balance',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'stripe_create_payment_link',
        description: 'Create a Stripe payment link for a product',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Product name' },
            amount: { type: 'number', description: 'Price in cents (e.g., 2999 for $29.99)' },
            currency: { type: 'string', description: 'Currency code (default: usd)' },
            recurring: { type: 'string', enum: ['one_time', 'monthly', 'yearly'], description: 'Payment type' }
          },
          required: ['name', 'amount']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'stripe_list_customers',
        description: 'List recent Stripe customers',
        parameters: {
          type: 'object',
          properties: { limit: { type: 'number', description: 'Number of customers (max 100)' } },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'stripe_create_invoice',
        description: 'Create and send an invoice to a customer',
        parameters: {
          type: 'object',
          properties: {
            customer_email: { type: 'string', description: 'Customer email' },
            items: { type: 'string', description: 'JSON array of {description, amount} items' }
          },
          required: ['customer_email', 'items']
        }
      }
    }
  ],

  init(deps) { stripeKey = deps.config.STRIPE_SECRET_KEY; },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'stripe_balance': return await getBalance();
      case 'stripe_create_payment_link': return await createPaymentLink(args);
      case 'stripe_list_customers': return await listCustomers(args.limit || 10);
      case 'stripe_create_invoice': return await createInvoice(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function stripeRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Authorization': `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(15000)
  };
  if (body) options.body = new URLSearchParams(body).toString();
  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Stripe ${res.status}`);
  }
  return res.json();
}

async function getBalance() {
  try {
    const data = await stripeRequest('/balance');
    const available = data.available.map(b => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(', ');
    const pending = data.pending.map(b => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(', ');
    return { success: true, available, pending };
  } catch (e) { return { success: false, error: e.message }; }
}

async function createPaymentLink(args) {
  try {
    // Create product
    const product = await stripeRequest('/products', 'POST', { name: args.name });
    // Create price
    const priceParams = { unit_amount: args.amount, currency: args.currency || 'usd', product: product.id };
    if (args.recurring && args.recurring !== 'one_time') {
      priceParams['recurring[interval]'] = args.recurring === 'yearly' ? 'year' : 'month';
    }
    const price = await stripeRequest('/prices', 'POST', priceParams);
    // Create payment link
    const link = await stripeRequest('/payment_links', 'POST', { 'line_items[0][price]': price.id, 'line_items[0][quantity]': 1 });
    return { success: true, url: link.url, amount: `$${(args.amount / 100).toFixed(2)}`, productId: product.id };
  } catch (e) { return { success: false, error: e.message }; }
}

async function listCustomers(limit) {
  try {
    const data = await stripeRequest(`/customers?limit=${limit}`);
    return {
      success: true,
      customers: data.data.map(c => ({ id: c.id, email: c.email, name: c.name, created: new Date(c.created * 1000).toISOString() }))
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function createInvoice(args) {
  try {
    // Find or create customer
    const customers = await stripeRequest(`/customers?email=${encodeURIComponent(args.customer_email)}&limit=1`);
    let customerId;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const newCust = await stripeRequest('/customers', 'POST', { email: args.customer_email });
      customerId = newCust.id;
    }
    // Create invoice
    const invoice = await stripeRequest('/invoices', 'POST', { customer: customerId, auto_advance: 'true' });
    // Add line items
    const items = JSON.parse(args.items);
    for (const item of items) {
      await stripeRequest('/invoiceitems', 'POST', {
        customer: customerId, invoice: invoice.id,
        description: item.description, amount: item.amount, currency: 'usd'
      });
    }
    // Finalize and send
    await stripeRequest(`/invoices/${invoice.id}/finalize`, 'POST');
    await stripeRequest(`/invoices/${invoice.id}/send`, 'POST');
    return { success: true, invoiceId: invoice.id, status: 'sent' };
  } catch (e) { return { success: false, error: e.message }; }
}
