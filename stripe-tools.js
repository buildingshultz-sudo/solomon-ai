/**
 * stripe-tools.js — Stripe Financial Orchestration for Solomon Bot
 * Provides balance queries, charge listings, payment link creation, and customer management.
 */
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

/**
 * Get the current Stripe account balance
 * @returns {Promise<object>} Balance object with available and pending amounts
 */
async function getBalance() {
  try {
    const balance = await stripe.balance.retrieve();
    const available = balance.available.map(b => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(', ');
    const pending = balance.pending.map(b => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`).join(', ');
    return {
      available,
      pending,
      raw: balance
    };
  } catch (err) {
    return { error: `Stripe balance error: ${err.message}` };
  }
}

/**
 * List recent charges
 * @param {number} limit - Number of charges to retrieve (default 10, max 100)
 * @returns {Promise<object>} List of recent charges
 */
async function listRecentCharges(limit = 10) {
  try {
    const charges = await stripe.charges.list({ limit: Math.min(limit, 100) });
    const formatted = charges.data.map(c => ({
      id: c.id,
      amount: `$${(c.amount / 100).toFixed(2)} ${c.currency.toUpperCase()}`,
      status: c.status,
      description: c.description || 'No description',
      customer: c.customer || 'Guest',
      created: new Date(c.created * 1000).toISOString()
    }));
    return { charges: formatted, total: charges.data.length };
  } catch (err) {
    return { error: `Stripe charges error: ${err.message}` };
  }
}

/**
 * Create a payment link for a product
 * @param {string} productName - Name of the product
 * @param {number} priceInCents - Price in cents (e.g., 1999 = $19.99)
 * @returns {Promise<object>} Payment link URL
 */
async function createPaymentLink(productName, priceInCents) {
  try {
    // Create a product
    const product = await stripe.products.create({ name: productName });
    
    // Create a price for the product
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: priceInCents,
      currency: 'usd'
    });
    
    // Create a payment link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }]
    });
    
    return {
      url: paymentLink.url,
      productId: product.id,
      priceId: price.id,
      amount: `$${(priceInCents / 100).toFixed(2)}`
    };
  } catch (err) {
    return { error: `Stripe payment link error: ${err.message}` };
  }
}

/**
 * List customers
 * @param {number} limit - Number of customers to retrieve (default 10, max 100)
 * @returns {Promise<object>} List of customers
 */
async function listCustomers(limit = 10) {
  try {
    const customers = await stripe.customers.list({ limit: Math.min(limit, 100) });
    const formatted = customers.data.map(c => ({
      id: c.id,
      name: c.name || 'No name',
      email: c.email || 'No email',
      created: new Date(c.created * 1000).toISOString()
    }));
    return { customers: formatted, total: customers.data.length };
  } catch (err) {
    return { error: `Stripe customers error: ${err.message}` };
  }
}

module.exports = {
  getBalance,
  listRecentCharges,
  createPaymentLink,
  listCustomers
};
