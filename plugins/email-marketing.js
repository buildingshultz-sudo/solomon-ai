/**
 * Email Marketing Plugin — SendGrid + Mailchimp
 */
let config = {};

module.exports = {
  name: 'email-marketing',
  version: '1.0.0',
  description: 'Email marketing: campaigns, sequences, list management via SendGrid and Mailchimp',
  requiredKeys: [],
  commands: ['/email_send', '/email_campaign', '/email_list'],
  tools: [
    {
      type: 'function', function: {
        name: 'send_email',
        description: 'Send a transactional email via SendGrid',
        parameters: { type: 'object', properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string', description: 'Email subject' },
          html: { type: 'string', description: 'HTML email body' },
          from: { type: 'string', description: 'Sender email (optional)' }
        }, required: ['to', 'subject', 'html'] }
      }
    },
    {
      type: 'function', function: {
        name: 'mailchimp_add_subscriber',
        description: 'Add a subscriber to a Mailchimp audience list',
        parameters: { type: 'object', properties: {
          email: { type: 'string', description: 'Subscriber email' },
          firstName: { type: 'string', description: 'First name' },
          lastName: { type: 'string', description: 'Last name' },
          listId: { type: 'string', description: 'Mailchimp list/audience ID' }
        }, required: ['email'] }
      }
    },
    {
      type: 'function', function: {
        name: 'mailchimp_campaign',
        description: 'Create and send a Mailchimp email campaign',
        parameters: { type: 'object', properties: {
          subject: { type: 'string', description: 'Campaign subject line' },
          html: { type: 'string', description: 'Campaign HTML content' },
          listId: { type: 'string', description: 'Target audience list ID' }
        }, required: ['subject', 'html'] }
      }
    }
  ],

  init(deps) { config = deps.config; },
  get _active() { return !!(config.SENDGRID_API_KEY || config.MAILCHIMP_API_KEY); },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'send_email': return await sendEmail(args);
      case 'mailchimp_add_subscriber': return await addSubscriber(args);
      case 'mailchimp_campaign': return await createCampaign(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function sendEmail(args) {
  if (!config.SENDGRID_API_KEY) return { success: false, error: 'SendGrid API key not configured' };
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: args.to }] }],
        from: { email: args.from || 'sol@solomonsforge.com' },
        subject: args.subject,
        content: [{ type: 'text/html', value: args.html }]
      })
    });
    return { success: res.status === 202, status: res.status };
  } catch (e) { return { success: false, error: e.message }; }
}

async function addSubscriber(args) {
  if (!config.MAILCHIMP_API_KEY) return { success: false, error: 'Mailchimp API key not configured' };
  const server = config.MAILCHIMP_SERVER || config.MAILCHIMP_API_KEY.split('-').pop();
  const listId = args.listId || 'default';
  try {
    const res = await fetch(`https://${server}.api.mailchimp.com/3.0/lists/${listId}/members`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${Buffer.from(`any:${config.MAILCHIMP_API_KEY}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_address: args.email, status: 'subscribed',
        merge_fields: { FNAME: args.firstName || '', LNAME: args.lastName || '' }
      })
    });
    const data = await res.json();
    return { success: res.ok, id: data.id, status: data.status };
  } catch (e) { return { success: false, error: e.message }; }
}

async function createCampaign(args) {
  if (!config.MAILCHIMP_API_KEY) return { success: false, error: 'Mailchimp not configured' };
  const server = config.MAILCHIMP_SERVER || config.MAILCHIMP_API_KEY.split('-').pop();
  try {
    const campaign = await fetch(`https://${server}.api.mailchimp.com/3.0/campaigns`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${Buffer.from(`any:${config.MAILCHIMP_API_KEY}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'regular',
        recipients: { list_id: args.listId },
        settings: { subject_line: args.subject, from_name: 'Solomon\'s Forge', reply_to: 'contact@solomonsforge.com' }
      })
    }).then(r => r.json());
    // Set content
    await fetch(`https://${server}.api.mailchimp.com/3.0/campaigns/${campaign.id}/content`, {
      method: 'PUT',
      headers: { 'Authorization': `Basic ${Buffer.from(`any:${config.MAILCHIMP_API_KEY}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: args.html })
    });
    return { success: true, campaignId: campaign.id, message: 'Campaign created (not sent). Use /send_campaign to send.' };
  } catch (e) { return { success: false, error: e.message }; }
}
