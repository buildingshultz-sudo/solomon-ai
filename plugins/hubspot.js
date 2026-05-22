/**
 * HubSpot CRM Plugin — Contacts, Deals, Pipeline Management
 */
let apiKey = '';

module.exports = {
  name: 'hubspot',
  version: '1.0.0',
  description: 'HubSpot CRM: contacts, deals, pipeline, customer lifecycle management',
  requiredKeys: ['HUBSPOT_API_KEY'],
  commands: ['/crm_contacts', '/crm_deals'],
  tools: [
    {
      type: 'function', function: {
        name: 'hubspot_contacts',
        description: 'List or search HubSpot contacts',
        parameters: { type: 'object', properties: {
          query: { type: 'string', description: 'Search query (email, name)' },
          limit: { type: 'number', description: 'Max results' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'hubspot_create_contact',
        description: 'Create a new contact in HubSpot CRM',
        parameters: { type: 'object', properties: {
          email: { type: 'string', description: 'Contact email' },
          firstName: { type: 'string', description: 'First name' },
          lastName: { type: 'string', description: 'Last name' },
          company: { type: 'string', description: 'Company name' }
        }, required: ['email'] }
      }
    },
    {
      type: 'function', function: {
        name: 'hubspot_deals',
        description: 'List deals in pipeline',
        parameters: { type: 'object', properties: {
          stage: { type: 'string', description: 'Pipeline stage filter' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'hubspot_create_deal',
        description: 'Create a new deal in HubSpot pipeline',
        parameters: { type: 'object', properties: {
          name: { type: 'string', description: 'Deal name' },
          amount: { type: 'number', description: 'Deal value' },
          stage: { type: 'string', description: 'Pipeline stage' },
          contactEmail: { type: 'string', description: 'Associated contact email' }
        }, required: ['name'] }
      }
    }
  ],

  init(deps) { apiKey = deps.config.HUBSPOT_API_KEY; },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'hubspot_contacts': return await listContacts(args);
      case 'hubspot_create_contact': return await createContact(args);
      case 'hubspot_deals': return await listDeals(args.stage);
      case 'hubspot_create_deal': return await createDeal(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function hsRequest(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000)
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.hubapi.com${endpoint}`, opts);
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

async function listContacts(args) {
  try {
    let data;
    if (args.query) {
      data = await hsRequest('/crm/v3/objects/contacts/search', 'POST', {
        query: args.query, limit: args.limit || 10,
        properties: ['email', 'firstname', 'lastname', 'company']
      });
    } else {
      data = await hsRequest(`/crm/v3/objects/contacts?limit=${args.limit || 10}&properties=email,firstname,lastname,company`);
    }
    return {
      success: true,
      contacts: (data.results || []).map(c => ({
        id: c.id, email: c.properties?.email, name: `${c.properties?.firstname || ''} ${c.properties?.lastname || ''}`.trim(),
        company: c.properties?.company
      }))
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function createContact(args) {
  try {
    const data = await hsRequest('/crm/v3/objects/contacts', 'POST', {
      properties: { email: args.email, firstname: args.firstName, lastname: args.lastName, company: args.company }
    });
    return { success: true, contactId: data.id };
  } catch (e) { return { success: false, error: e.message }; }
}

async function listDeals(stage = null) {
  try {
    const data = await hsRequest('/crm/v3/objects/deals?limit=20&properties=dealname,amount,dealstage,closedate');
    let deals = (data.results || []).map(d => ({
      id: d.id, name: d.properties?.dealname, amount: d.properties?.amount,
      stage: d.properties?.dealstage, closeDate: d.properties?.closedate
    }));
    if (stage) deals = deals.filter(d => d.stage === stage);
    return { success: true, deals };
  } catch (e) { return { success: false, error: e.message }; }
}

async function createDeal(args) {
  try {
    const data = await hsRequest('/crm/v3/objects/deals', 'POST', {
      properties: { dealname: args.name, amount: args.amount || 0, dealstage: args.stage || 'appointmentscheduled' }
    });
    return { success: true, dealId: data.id };
  } catch (e) { return { success: false, error: e.message }; }
}
