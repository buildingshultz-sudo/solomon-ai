'use strict';
// caleb-relay.js — Solomon → Caleb (Cowork desktop agent on Jed's PC) bridge.
//
// Caleb tasks are POSTed to the existing PC relay. The relay endpoint on the
// PC side writes the payload into `D:\caleb-queue\` for the desktop agent to
// pick up. The PC relay endpoint name is /caleb-task — if the PC relay
// doesn't yet expose that endpoint we surface a clear pending message so the
// PC-side setup work is obvious.

require('dotenv').config({ path: '/root/solomon-v4/.env' });
const axios = require('axios');

const PC_RELAY_URL = process.env.PC_RELAY_URL;
const PC_RELAY_SECRET = process.env.PC_RELAY_SECRET;

function shapeCalebPayload(template, inputs, filledPrompt, ctx = {}) {
  return {
    schema_version: 1,
    task: template.name,
    template_id: template.id,
    handler: 'caleb',
    variables: inputs || {},
    filled_prompt: filledPrompt,
    step_by_step: template.caleb_steps || [],
    priority: template.priority || 'normal',
    created: new Date().toISOString(),
    classifier: ctx.classification || null,
    nathan_consult: ctx.nathanResult || null
  };
}

async function sendCalebTask(payload) {
  if (!PC_RELAY_URL || PC_RELAY_URL === 'PLACEHOLDER') {
    return { ok: false, error: 'PC_RELAY_URL not configured' };
  }
  if (!PC_RELAY_SECRET) {
    return { ok: false, error: 'PC_RELAY_SECRET not configured' };
  }
  try {
    const res = await axios.post(`${PC_RELAY_URL}/caleb-task`, payload, {
      headers: { 'X-Secret': PC_RELAY_SECRET, 'Content-Type': 'application/json' },
      timeout: 15000
    });
    return { ok: true, response: res.data };
  } catch (err) {
    const status = err.response && err.response.status;
    const detail = err.response && err.response.data || err.message;
    if (status === 404) {
      return {
        ok: false,
        error: 'PC relay does not yet expose /caleb-task endpoint. PC-side relay needs the Caleb queue writer added.',
        pending_setup: true
      };
    }
    return { ok: false, error: typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400) };
  }
}

async function dispatchCaleb(template, inputs, filledPrompt, ctx = {}) {
  const payload = shapeCalebPayload(template, inputs, filledPrompt, ctx);
  const send = await sendCalebTask(payload);
  return { payload, send };
}

module.exports = { shapeCalebPayload, sendCalebTask, dispatchCaleb };
