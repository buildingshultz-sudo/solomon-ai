/**
 * Google Plugin — Gmail, Calendar, Drive, Sheets
 */
let config = {};

module.exports = {
  name: 'google',
  version: '1.0.0',
  description: 'Google Workspace: Gmail, Calendar, Drive, Sheets integration',
  requiredKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_REFRESH_TOKEN'],
  commands: ['/gmail', '/calendar', '/drive'],
  tools: [
    {
      type: 'function', function: {
        name: 'gmail_send',
        description: 'Send an email via Gmail',
        parameters: { type: 'object', properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text or HTML)' }
        }, required: ['to', 'subject', 'body'] }
      }
    },
    {
      type: 'function', function: {
        name: 'gmail_read',
        description: 'Read recent emails from Gmail inbox',
        parameters: { type: 'object', properties: {
          query: { type: 'string', description: 'Gmail search query (e.g., "from:stripe.com")' },
          maxResults: { type: 'number', description: 'Number of emails to return' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'calendar_events',
        description: 'Get upcoming calendar events',
        parameters: { type: 'object', properties: {
          days: { type: 'number', description: 'Number of days ahead to check (default 7)' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'calendar_create',
        description: 'Create a calendar event',
        parameters: { type: 'object', properties: {
          title: { type: 'string', description: 'Event title' },
          start: { type: 'string', description: 'Start time (ISO 8601)' },
          end: { type: 'string', description: 'End time (ISO 8601)' },
          description: { type: 'string', description: 'Event description' }
        }, required: ['title', 'start'] }
      }
    },
    {
      type: 'function', function: {
        name: 'sheets_read',
        description: 'Read data from a Google Sheet',
        parameters: { type: 'object', properties: {
          spreadsheetId: { type: 'string', description: 'Google Sheets ID' },
          range: { type: 'string', description: 'Cell range (e.g., "Sheet1!A1:D10")' }
        }, required: ['spreadsheetId', 'range'] }
      }
    },
    {
      type: 'function', function: {
        name: 'sheets_write',
        description: 'Write data to a Google Sheet',
        parameters: { type: 'object', properties: {
          spreadsheetId: { type: 'string', description: 'Google Sheets ID' },
          range: { type: 'string', description: 'Cell range' },
          values: { type: 'string', description: 'JSON 2D array of values' }
        }, required: ['spreadsheetId', 'range', 'values'] }
      }
    }
  ],

  init(deps) { config = deps.config; },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'gmail_send': return await gmailSend(args);
      case 'gmail_read': return await gmailRead(args.query, args.maxResults);
      case 'calendar_events': return await calendarEvents(args.days || 7);
      case 'calendar_create': return await calendarCreate(args);
      case 'sheets_read': return await sheetsRead(args.spreadsheetId, args.range);
      case 'sheets_write': return await sheetsWrite(args.spreadsheetId, args.range, args.values);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      refresh_token: config.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google OAuth refresh failed');
  return data.access_token;
}

async function googleRequest(url, method = 'GET', body = null) {
  const token = await getAccessToken();
  const opts = { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function gmailSend(args) {
  try {
    const raw = Buffer.from(
      `To: ${args.to}\r\nSubject: ${args.subject}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${args.body}`
    ).toString('base64url');
    await googleRequest('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'POST', { raw });
    return { success: true, message: `Email sent to ${args.to}` };
  } catch (e) { return { success: false, error: e.message }; }
}

async function gmailRead(query = '', maxResults = 5) {
  try {
    const q = query || 'in:inbox';
    const list = await googleRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`);
    if (!list.messages) return { success: true, emails: [] };
    const emails = [];
    for (const msg of list.messages.slice(0, maxResults)) {
      const detail = await googleRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const headers = detail.payload?.headers || [];
      emails.push({
        id: msg.id,
        from: headers.find(h => h.name === 'From')?.value,
        subject: headers.find(h => h.name === 'Subject')?.value,
        date: headers.find(h => h.name === 'Date')?.value,
        snippet: detail.snippet
      });
    }
    return { success: true, emails };
  } catch (e) { return { success: false, error: e.message }; }
}

async function calendarEvents(days = 7) {
  try {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + days * 86400000).toISOString();
    const data = await googleRequest(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${future}&singleEvents=true&orderBy=startTime`);
    return {
      success: true,
      events: (data.items || []).map(e => ({
        title: e.summary, start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date, location: e.location, description: e.description?.slice(0, 100)
      }))
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function calendarCreate(args) {
  try {
    const event = {
      summary: args.title,
      start: { dateTime: args.start, timeZone: config.TIMEZONE || 'America/Chicago' },
      end: { dateTime: args.end || new Date(new Date(args.start).getTime() + 3600000).toISOString(), timeZone: config.TIMEZONE || 'America/Chicago' },
      description: args.description || ''
    };
    const result = await googleRequest('https://www.googleapis.com/calendar/v3/calendars/primary/events', 'POST', event);
    return { success: true, eventId: result.id, link: result.htmlLink };
  } catch (e) { return { success: false, error: e.message }; }
}

async function sheetsRead(spreadsheetId, range) {
  try {
    const data = await googleRequest(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
    return { success: true, values: data.values || [] };
  } catch (e) { return { success: false, error: e.message }; }
}

async function sheetsWrite(spreadsheetId, range, values) {
  try {
    const parsed = JSON.parse(values);
    await googleRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      'PUT', { values: parsed }
    );
    return { success: true, message: `Written to ${range}` };
  } catch (e) { return { success: false, error: e.message }; }
}
