#!/usr/bin/env node
/**
 * Send Jed the pool filter hose fitting links via Telegram
 * WaterRebirth FP1600WR pump uses 1.5" hose connections
 */
const https = require('https');

const TOKEN = '8452080979:AAEcPILrHmKoPU6SYYC-Hhb9Ff58HrW84cU';
const CHAT_ID = '8762434280';

const message = `🔧 *Pool Filter Hose Fittings — Found It*

Your pump is the *WaterRebirth FP1600WR* (400 GPH solar/AC). It uses *1.5" hose connections*.

Here's what I found at each store:

━━━━━━━━━━━━━━━━━━━━
🟠 *MENARDS* (Valparaiso)
━━━━━━━━━━━━━━━━━━━━
• *1.5" Polypropylene Bulkhead Union Fitting* — Green Leaf Inc
  Model: TF150 | Tank/filter bulkhead, seals through walls
  🔗 https://www.menards.com/main/plumbing/pipe-fittings/tank-fittings-strainers/green-leaf-inc-polypropylene-bulkhead-union-fitting/tf150/p-1444431650126-c-8560.htm

• *Bestway 1.5" Replacement Hose*
  🔗 https://www.menards.com/main/outdoors/pools-accessories/bestway-reg-1-5-replacement-hose/58780e/p-1642874269059950-c-10137.htm

• *Pool & Spa Tubing (1.5" section)*
  🔗 https://www.menards.com/main/plumbing/hoses-tubing/pool-spa-tubing/c-8582.htm

━━━━━━━━━━━━━━━━━━━━
🟠 *HOME DEPOT*
━━━━━━━━━━━━━━━━━━━━
• *Funsicle 59" x 1.5" Universal Replacement Hose Kit* — $17.49 ✅ Ships FREE by Fri May 22
  Model: P56000017-HD
  🔗 https://www.homedepot.com/p/P56000017-HD

• *Haviland 6 ft x 1.5" Heavy-Duty Filter Hose* — $25.22
  Model: PA00278-HSCS6
  🔗 https://www.homedepot.com/p/Haviland-6-ft-x-1-5-in-Heavy-Duty-Filter-Hose-PA00278-HSCS6/317285604

• *Intex 1.5" 59" Replacement Hose* — $31.99
  Model: 29060E-HD
  🔗 https://www.homedepot.com/p/Intex-1-5-in-Dia-Accessory-Pool-1-500-GPH-Pump-Replacement-59-in-Hose-29060E-HD/317285605

• *Everbilt 1-1/2" Barb x 1-1/2" MIP Nylon Adapter* (for hard plumbing)
  🔗 https://www.homedepot.com/p/Everbilt-1-1-2-in-Barb-x-1-1-2-in-MIP-Nylon-Adapter-Fitting-800379/300862704

━━━━━━━━━━━━━━━━━━━━
🟠 *LOWE'S*
━━━━━━━━━━━━━━━━━━━━
• *Project Source 1.5" Threaded Pool Hose Adapter* ⭐ 4.6/5 (33 reviews)
  Fits 1.5" flex hose, 1.5" threaded male fitting, for above/in-ground pools & spas
  🔗 https://www.lowes.com/pd/Project-Source-AFT601-PS-1-5-inch-Threaded-Pool-Hose-Adapter/5014455830

• *Full 1.5" hose adapter section at Lowe's:*
  🔗 https://www.lowes.com/pl/pools/hose-adapter/760377631-4294719841

━━━━━━━━━━━━━━━━━━━━
💡 *Also — direct from WaterRebirth:*
They sell an OEM hose adapter specifically for this pump line for *$10* (was $15):
🔗 https://water-rebirth.com/product/ps-1700-water-pump-hose-adapter/

*My pick:* Grab the Lowe's Project Source adapter for local pickup — 4.6 stars, designed exactly for this. Or the Funsicle hose kit from Home Depot if you need the full hose too.`;

function sendMessage(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (parsed.ok) {
          console.log('[OK] Message sent to Jed. Message ID:', parsed.result.message_id);
          resolve(parsed);
        } else {
          console.error('[FAIL]', parsed.description);
          reject(new Error(parsed.description));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

sendMessage(message).catch(console.error);
