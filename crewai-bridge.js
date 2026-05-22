/**
 * Solomon CrewAI Bridge
 * Connects the Node.js Telegram bot to the Python CrewAI backend.
 * Replaces the old worker-adapter.js with a clean HTTP-based interface.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const CREWAI_URL = 'http://127.0.0.1:5000';
const POLL_INTERVAL = 5000; // Check task status every 5s
const DELIVERABLES_DIR = '/root/solomon-bot/deliverables';

class CrewAIBridge {
  constructor(bot, chatId) {
    this.bot = bot;
    this.chatId = chatId;
    this.activeTasks = new Map();
    this.pollTimer = null;
  }

  /**
   * Submit a task to CrewAI and track it for completion.
   */
  async submitTask(title, description, options = {}) {
    const taskId = options.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    
    const payload = JSON.stringify({
      id: taskId,
      title,
      description: description || title,
      agent: options.agent || null,
    });

    try {
      const response = await this._request('POST', '/task/submit', payload);
      const data = JSON.parse(response);
      
      if (data.task_id) {
        this.activeTasks.set(data.task_id, {
          title,
          startedAt: Date.now(),
          agent: data.agent,
        });
        
        console.log(`[BRIDGE] Task submitted: ${data.task_id} → ${data.agent} agent`);
        
        // Start polling if not already
        if (!this.pollTimer) {
          this._startPolling();
        }
        
        return { success: true, taskId: data.task_id, agent: data.agent };
      }
      
      return { success: false, error: data.error || 'Unknown error' };
    } catch (err) {
      console.error(`[BRIDGE] Submit failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Submit multiple tasks for parallel execution.
   */
  async submitBatch(tasks) {
    const payload = JSON.stringify({
      tasks: tasks.map((t, i) => ({
        id: t.id || `batch_${Date.now()}_${i}`,
        title: t.title,
        description: t.description || t.title,
        agent: t.agent || null,
      }))
    });

    try {
      const response = await this._request('POST', '/task/batch', payload);
      const data = JSON.parse(response);
      
      if (data.tasks) {
        for (const t of data.tasks) {
          this.activeTasks.set(t.task_id, {
            title: tasks.find(x => x.id === t.task_id)?.title || t.task_id,
            startedAt: Date.now(),
            agent: t.agent,
          });
        }
        
        console.log(`[BRIDGE] Batch submitted: ${data.submitted} tasks in parallel`);
        
        if (!this.pollTimer) {
          this._startPolling();
        }
        
        return { success: true, submitted: data.submitted, tasks: data.tasks };
      }
      
      return { success: false, error: data.error || 'Unknown error' };
    } catch (err) {
      console.error(`[BRIDGE] Batch submit failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check health of the CrewAI backend.
   */
  async health() {
    try {
      const response = await this._request('GET', '/health');
      return JSON.parse(response);
    } catch (err) {
      return { status: 'offline', error: err.message };
    }
  }

  /**
   * Poll for completed tasks and deliver results.
   */
  _startPolling() {
    this.pollTimer = setInterval(async () => {
      if (this.activeTasks.size === 0) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
        return;
      }

      for (const [taskId, meta] of this.activeTasks.entries()) {
        try {
          const response = await this._request('GET', `/task/status/${taskId}`);
          const data = JSON.parse(response);
          
          if (data.status === 'completed') {
            console.log(`[BRIDGE] Task completed: ${taskId} (${meta.title})`);
            await this._deliverResult(taskId, data, meta);
            this.activeTasks.delete(taskId);
          } else if (data.status === 'failed') {
            console.log(`[BRIDGE] Task failed: ${taskId} — ${data.error}`);
            await this.bot.sendMessage(this.chatId, 
              `❌ Task failed: ${meta.title}\nError: ${data.error || 'Unknown'}\nAgent: ${meta.agent}`
            );
            this.activeTasks.delete(taskId);
          }
        } catch (err) {
          // Silently retry on next poll
        }
      }
    }, POLL_INTERVAL);
  }

  /**
   * Deliver a completed task result as PDF via Telegram.
   */
  async _deliverResult(taskId, data, meta) {
    const elapsed = ((Date.now() - meta.startedAt) / 1000).toFixed(0);
    
    // Try PDF first
    if (data.pdf_path && fs.existsSync(data.pdf_path)) {
      try {
        await this.bot.sendDocument(this.chatId, data.pdf_path, {
          caption: `✅ ${meta.title}\n🤖 Agent: ${meta.agent}\n⏱ ${elapsed}s | 📄 ${data.content_length} chars`,
        });
        console.log(`[BRIDGE] PDF delivered: ${data.pdf_path}`);
        return;
      } catch (err) {
        console.error(`[BRIDGE] PDF send failed: ${err.message}`);
      }
    }
    
    // Fallback: send .md file as document
    if (data.md_path && fs.existsSync(data.md_path)) {
      try {
        await this.bot.sendDocument(this.chatId, data.md_path, {
          caption: `✅ ${meta.title}\n🤖 Agent: ${meta.agent}\n⏱ ${elapsed}s | 📄 ${data.content_length} chars\n(PDF generation failed, sending markdown)`,
        });
        console.log(`[BRIDGE] MD delivered: ${data.md_path}`);
        return;
      } catch (err) {
        console.error(`[BRIDGE] MD send failed: ${err.message}`);
      }
    }
    
    // Last resort: send text summary
    await this.bot.sendMessage(this.chatId, 
      `✅ Task completed: ${meta.title}\n🤖 Agent: ${meta.agent}\n⏱ ${elapsed}s\n\n(File delivery failed — check VPS deliverables directory)`
    );
  }

  /**
   * Make HTTP request to CrewAI backend.
   */
  _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, CREWAI_URL);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = CrewAIBridge;
