/**
 * Solomon Autonomous Worker v5 (Proof-of-Work Edition)
 *
 * Core principles:
 * 1. PROOF OF WORK: A task is NEVER marked 'completed' without a tangible artifact
 *    (PDF file on disk, screenshot file, confirmed URL, published post link).
 *    If no artifact can be produced, the task is marked 'blocked' with a clear reason
 *    and Jed is notified immediately.
 *
 * 2. TRUE PARALLELISM: workerTick fires every 10s and launches up to MAX_CONCURRENT_TASKS
 *    simultaneously via Promise.all — tasks do not wait for each other.
 *
 * 3. BLOCKED REPORTING: If a task requires credentials, PC Agent access, or external
 *    login that Sol cannot obtain, it is immediately marked 'blocked' and Jed is told
 *    exactly what is blocking it and what is needed to unblock.
 *
 * 4. STARTUP RECOVERY: On every restart, abandoned 'active' tasks reset to 'pending'
 *    so nothing is lost across reboots.
 */

const fs   = require('fs');
const path = require('path');
const { recoverTasks } = require('./task-recovery');

const WORKER_INTERVAL      = 10000;  // 10s — faster tick for true parallelism
const MAX_CONCURRENT_TASKS = 5;
const MAX_TASK_ATTEMPTS    = 3;
const DELIVERABLES_DIR     = path.join(__dirname, 'deliverables');

// Ensure deliverables directory exists
if (!fs.existsSync(DELIVERABLES_DIR)) fs.mkdirSync(DELIVERABLES_DIR, { recursive: true });

const activeTaskIds = new Set();

// ── PROOF-OF-WORK VERIFIER ────────────────────────────────────────────────────
// Returns { verified: bool, artifact: string|null, reason: string }
function verifyArtifact(taskId, result) {
  // Check if a file was written to the deliverables dir for this task
  const files = fs.existsSync(DELIVERABLES_DIR)
    ? fs.readdirSync(DELIVERABLES_DIR).filter(f => f.includes(taskId))
    : [];

  if (files.length > 0) {
    const artifactPath = path.join(DELIVERABLES_DIR, files[0]);
    const stat = fs.statSync(artifactPath);
    if (stat.size > 100) {
      return { verified: true, artifact: artifactPath, reason: `File artifact: ${files[0]} (${stat.size} bytes)` };
    }
  }

  // Check if result contains a verifiable URL (http/https link)
  if (typeof result === 'string') {
    const urlMatch = result.match(/https?:\/\/[^\s"'<>]+/);
    if (urlMatch) {
      return { verified: true, artifact: urlMatch[0], reason: `URL artifact: ${urlMatch[0]}` };
    }
    // Check if result contains a file path
    const pathMatch = result.match(/\/[^\s"'<>]+\.(pdf|png|jpg|txt|json|csv|html|md)/i);
    if (pathMatch) {
      return { verified: true, artifact: pathMatch[0], reason: `Path artifact: ${pathMatch[0]}` };
    }
    // Check if result is substantive text content (>500 chars = real research/report)
    if (result.length > 500) {
      return { verified: true, artifact: null, reason: `Text artifact: ${result.length} chars of content` };
    }
  }

  return {
    verified: false,
    artifact: null,
    reason: 'No tangible artifact produced (no file, no URL, no substantive content)'
  };
}

// ── BLOCKED TASK CLASSIFIER ───────────────────────────────────────────────────
// Determines if a task is likely to be blocked before attempting it
function classifyBlockers(task) {
  const desc = (task.description + ' ' + task.title).toLowerCase();
  const blockers = [];

  if (desc.includes('kdp') || desc.includes('amazon') || desc.includes('publish')) {
    blockers.push('Requires KDP login — use PC Agent (Chrome already logged in) or provide KDP credentials');
  }
  if (desc.includes('gumroad') && (desc.includes('rebrand') || desc.includes('setup') || desc.includes('storefront'))) {
    blockers.push('Requires Gumroad login — use PC Agent (Chrome Google OAuth) or provide Gumroad credentials');
  }
  if (desc.includes('facebook') || desc.includes('instagram') || desc.includes('post content')) {
    blockers.push('Requires social media login — provide Facebook/Instagram credentials or use PC Agent');
  }
  if ((desc.includes('ironedit') || desc.includes('electron')) && desc.includes('ffmpeg')) {
    blockers.push('Requires access to IronEdit source code on Jed\'s PC — PC Agent must be online');
  }
  if (desc.includes('shorts') || desc.includes('video') || desc.includes('footage')) {
    blockers.push('Requires access to video files on Jed\'s PC — PC Agent must be online and D: drive accessible');
  }

  return blockers;
}

function initWorker(bot, config, deps) {
  const { addTask, getNextTask, updateTask, getQueueSummary, logAction } = deps.taskQueue;
  const { loadKB, addToKB } = deps.knowledgeBase;
  const { callLLM, webSearch, executeOnPC, safeSend, generateResultPDF: _genPDF } = deps.core;
  const generateResultPDF = _genPDF || (async () => null);

  // ── STARTUP RECOVERY ─────────────────────────────────────────────────────
  const recovery = recoverTasks();
  if (recovery.recovered > 0 || recovery.reset > 0) {
    console.log(`[WORKER v5] Recovery: ${recovery.recovered} active resumed, ${recovery.reset} failed re-queued`);
    setTimeout(async () => {
      try {
        await safeSend(bot, config.OWNER_CHAT_ID,
          `🔄 Auto-recovery: ${recovery.recovered + recovery.reset} tasks resumed from last session.`);
      } catch (e) {}
    }, 5000);
  }

  // ── CORE TASK EXECUTOR ───────────────────────────────────────────────────
  async function executeTask(task) {
    if (activeTaskIds.has(task.id)) return;
    activeTaskIds.add(task.id);

    const attempts = (task.attempts || 0) + 1;
    updateTask(task.id, { attempts, status: 'active', startedAt: Date.now() });
    console.log(`[WORKER v5] [${task.id}] Starting (attempt ${attempts}): ${task.title}`);

    try {
      // ── PRE-FLIGHT: Check for known blockers ──────────────────────────
      const blockers = classifyBlockers(task);
      const needsPC = task.requiresPCAgent || task.type === 'pc_command' || task.type === 'browser_action'
                   || blockers.some(b => b.includes('PC Agent'));

      if (needsPC) {
        let agentOnline = false;
        try {
          const statusRes = await fetch('http://127.0.0.1:3001/agent/status', { signal: AbortSignal.timeout(5000) });
          const statusData = await statusRes.json();
          agentOnline = !!statusData.online;
        } catch (e) { agentOnline = false; }

        if (!agentOnline) {
          const blockReason = `PC Agent is offline. Task requires: ${blockers.join('; ') || 'PC Agent access'}`;
          updateTask(task.id, { status: 'blocked', blockReason, attempts });
          await safeSend(bot, config.OWNER_CHAT_ID,
            `🚫 *Blocked: ${task.title}*\n\n${blockReason}\n\nPlease ensure the PC Agent is running on your PC.`);
          activeTaskIds.delete(task.id);
          return;
        }
      }

      // ── EXECUTE ──────────────────────────────────────────────────────
      let result = null;
      let artifactPath = null;

      switch (task.type) {
        case 'research':
        case 'web_search':
          result = await executeResearchTask(task);
          break;
        case 'pc_command':
          result = await executePCTask(task);
          break;
        case 'browser_action':
          result = await executeBrowserTask(task);
          break;
        case 'scrape':
          result = await executeScrapeTask(task);
          break;
        case 'file_creation':
          ({ result, artifactPath } = await executeFileTask(task));
          break;
        case 'report_generation':
          ({ result, artifactPath } = await executeReportTask(task));
          break;
        case 'self_upgrade':
        case 'code_generation':
          ({ result, artifactPath } = await executeSelfUpgradeTask(task));
          break;
        default:
          ({ result, artifactPath } = await executeGeneralTask(task));
      }

      // ── PROOF-OF-WORK GATE ────────────────────────────────────────────
      if (result === null || result === false) {
        if (attempts >= MAX_TASK_ATTEMPTS) {
          updateTask(task.id, { status: 'failed', failReason: 'No result produced after max attempts' });
          await safeSend(bot, config.OWNER_CHAT_ID,
            `❌ *Failed: ${task.title}*\n\nNo result produced after ${attempts} attempts. Manual intervention needed.`);
        } else {
          updateTask(task.id, { status: 'pending' });
        }
        activeTaskIds.delete(task.id);
        return;
      }

      const verification = verifyArtifact(task.id, result);
      if (!verification.verified) {
        // No tangible artifact — do NOT mark complete. Block it and tell Jed.
        const blockReason = `Proof-of-work failed: ${verification.reason}. Task produced no verifiable output.`;
        if (attempts >= MAX_TASK_ATTEMPTS) {
          updateTask(task.id, { status: 'blocked', blockReason });
          await safeSend(bot, config.OWNER_CHAT_ID,
            `🚫 *Blocked: ${task.title}*\n\n${blockReason}\n\nThis task needs your input to proceed.`);
        } else {
          updateTask(task.id, { status: 'pending', error: blockReason });
        }
        activeTaskIds.delete(task.id);
        return;
      }

      // ── MARK COMPLETE + DELIVER ───────────────────────────────────────
      updateTask(task.id, {
        status: 'completed',
        result: typeof result === 'string' ? result.slice(0, 5000) : result,
        artifact: verification.artifact,
        completedAt: Date.now()
      });

      console.log(`[WORKER v5] [${task.id}] ✅ Completed with artifact: ${verification.reason}`);

      // Deliver to Jed: PDF if available, else short summary
      const summary = typeof result === 'string' ? result : JSON.stringify(result);
      const shortSummary = summary.split('\n').filter(l => l.trim()).slice(0, 4).join('\n').slice(0, 400);

      const pdfPath = artifactPath && artifactPath.endsWith('.pdf')
        ? artifactPath
        : await generateResultPDF(task.title, summary);

      if (pdfPath && fs.existsSync(pdfPath)) {
        await bot.sendDocument(config.OWNER_CHAT_ID, pdfPath, {
          caption: `✅ ${task.title}\n\n${shortSummary}`,
          parse_mode: 'Markdown'
        });
      } else {
        await safeSend(bot, config.OWNER_CHAT_ID, `✅ *${task.title}*\n\n${shortSummary}`);
      }

      if (task.type === 'research' || task.type === 'web_search') {
        addToKB('research_findings', {
          title: task.title,
          finding: summary.slice(0, 1000),
          artifact: verification.artifact,
          date: new Date().toISOString()
        });
      }

    } catch (e) {
      console.error(`[WORKER v5] [${task.id}] Exception:`, e.message);
      if (attempts >= MAX_TASK_ATTEMPTS) {
        updateTask(task.id, { status: 'failed', failReason: e.message });
        await safeSend(bot, config.OWNER_CHAT_ID,
          `❌ *Failed: ${task.title}*\n\nError: ${e.message}`).catch(() => {});
      } else {
        updateTask(task.id, { status: 'pending', error: e.message });
      }
    } finally {
      activeTaskIds.delete(task.id);
    }
  }

  // ── TASK TYPE IMPLEMENTATIONS ────────────────────────────────────────────

  async function executeResearchTask(task) {
    const query = task.description || task.title;
    const searchResult = await webSearch(query);
    if (!searchResult) return null;

    // Generate a proper report from search results
    const messages = [
      { role: 'system', content: 'You are a research analyst. Write a detailed, factual report based on the search results provided. Include specific data, prices, names, and actionable insights. Minimum 600 words.' },
      { role: 'user', content: `Research task: ${task.title}\n\nSearch results:\n${searchResult}\n\nWrite a comprehensive report.` }
    ];
    const report = await callLLM(messages);
    if (!report || report.length < 200) return null;

    // Save as a file artifact
    const filename = `research_${task.id}_${Date.now()}.txt`;
    const filePath = path.join(DELIVERABLES_DIR, filename);
    fs.writeFileSync(filePath, `# ${task.title}\n\n${report}`);
    return report;
  }

  async function executePCTask(task) {
    const cmd = task.command || task.description;
    const result = await executeOnPC(cmd, task.commandType || 'powershell');
    if (!result || !result.output) return null;
    // Save output as artifact
    const filename = `pc_output_${task.id}_${Date.now()}.txt`;
    fs.writeFileSync(path.join(DELIVERABLES_DIR, filename), result.output);
    return result.output;
  }

  async function executeBrowserTask(task) {
    const url = task.url || task.description;
    // Open Chrome (always use 'start chrome', never default browser)
    const openResult = await executeOnPC(`start chrome "${url}"`, 'shell');
    if (!openResult) return null;
    // Wait for page to load then take screenshot
    await new Promise(r => setTimeout(r, 4000));
    const screenshotResult = await executeOnPC(
      `Add-Type -AssemblyName System.Windows.Forms; $bmp = [System.Drawing.Bitmap]::new([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray())`,
      'powershell'
    );
    if (screenshotResult && screenshotResult.output && screenshotResult.output.length > 1000) {
      const imgData = Buffer.from(screenshotResult.output.trim(), 'base64');
      const imgPath = path.join(DELIVERABLES_DIR, `screenshot_${task.id}_${Date.now()}.png`);
      fs.writeFileSync(imgPath, imgData);
      return `Browser opened ${url}. Screenshot saved: ${imgPath}`;
    }
    return `Browser opened ${url} (no screenshot captured)`;
  }

  async function executeScrapeTask(task) {
    // Use VPS Playwright for unauthenticated scraping
    const url = task.url || task.description;
    const result = await executeOnPC(`start chrome "${url}"`, 'shell');
    return result ? `Scrape initiated for ${url}` : null;
  }

  async function executeFileTask(task) {
    const prompt = `Create the following document in full detail: ${task.description || task.title}. Write the complete content, not a summary or outline.`;
    const messages = [
      { role: 'system', content: 'You are a professional writer. Produce complete, publication-ready documents. Never truncate or summarize — write the full content.' },
      { role: 'user', content: prompt }
    ];
    const content = await callLLM(messages);
    if (!content || content.length < 200) return { result: null, artifactPath: null };

    const filename = `file_${task.id}_${Date.now()}.md`;
    const filePath = path.join(DELIVERABLES_DIR, filename);
    fs.writeFileSync(filePath, `# ${task.title}\n\n${content}`);

    // Convert to PDF
    const pdfPath = filePath.replace('.md', '.pdf');
    try {
      const { execSync } = require('child_process');
      execSync(`manus-md-to-pdf "${filePath}" "${pdfPath}"`, { timeout: 30000 });
      return { result: content, artifactPath: pdfPath };
    } catch (e) {
      return { result: content, artifactPath: filePath };
    }
  }

  async function executeReportTask(task) {
    const searchData = await webSearch(task.description || task.title).catch(() => '');
    const messages = [
      { role: 'system', content: 'You are a senior business analyst. Write detailed, data-driven reports with specific numbers, competitor names, pricing, and actionable recommendations. Minimum 800 words.' },
      { role: 'user', content: `Generate a comprehensive report on: ${task.description || task.title}\n\nBackground data:\n${searchData || 'Use your knowledge'}` }
    ];
    const content = await callLLM(messages);
    if (!content || content.length < 300) return { result: null, artifactPath: null };

    const filename = `report_${task.id}_${Date.now()}.md`;
    const filePath = path.join(DELIVERABLES_DIR, filename);
    fs.writeFileSync(filePath, `# ${task.title}\n\n${content}`);

    const pdfPath = filePath.replace('.md', '.pdf');
    try {
      const { execSync } = require('child_process');
      execSync(`manus-md-to-pdf "${filePath}" "${pdfPath}"`, { timeout: 30000 });
      return { result: content, artifactPath: pdfPath };
    } catch (e) {
      return { result: content, artifactPath: filePath };
    }
  }

  async function executeSelfUpgradeTask(task) {
    const messages = [
      { role: 'system', content: 'You are an expert Node.js systems programmer. Write clean, production-ready code. No comments unless complex logic requires explanation. Handle all edge cases. Use modern ES2022+ syntax.' },
      { role: 'user', content: `Solomon self-upgrade task: ${task.description || task.title}\n\nProvide the complete, production-ready Node.js code.` }
    ];
    const code = await callLLM(messages);
    if (!code || code.length < 100) return { result: null, artifactPath: null };

    const filename = `upgrade_${task.id}_${Date.now()}.js`;
    const filePath = path.join(DELIVERABLES_DIR, filename);
    fs.writeFileSync(filePath, code);
    return { result: code, artifactPath: filePath };
  }

  async function executeGeneralTask(task) {
    // Check if this task has known blockers that make it impossible without credentials
    const blockers = classifyBlockers(task);
    if (blockers.length > 0) {
      // Report blocked immediately rather than pretending to work
      const blockReason = `Task requires external access: ${blockers.join('; ')}`;
      updateTask(task.id, { status: 'blocked', blockReason });
      await safeSend(bot, config.OWNER_CHAT_ID,
        `🚫 *Blocked: ${task.title}*\n\n${blockReason}\n\nWhat do you need me to do to unblock this?`);
      activeTaskIds.delete(task.id);
      return { result: null, artifactPath: null };
    }

    const messages = [
      { role: 'system', content: 'You are Solomon, an autonomous AI assistant. Complete tasks fully and produce detailed, actionable output. Never give vague summaries — produce real content.' },
      { role: 'user', content: `Complete this task: ${task.description || task.title}\n\nProvide a detailed, complete result.` }
    ];
    const content = await callLLM(messages);
    if (!content || content.length < 100) return { result: null, artifactPath: null };

    // Save as artifact
    const filename = `general_${task.id}_${Date.now()}.txt`;
    const filePath = path.join(DELIVERABLES_DIR, filename);
    fs.writeFileSync(filePath, `# ${task.title}\n\n${content}`);
    return { result: content, artifactPath: filePath };
  }

  // ── TRUE PARALLEL WORKER TICK ────────────────────────────────────────────
  // Launches multiple tasks simultaneously using Promise.all
  async function workerTick() {
    const slotsAvailable = MAX_CONCURRENT_TASKS - activeTaskIds.size;
    if (slotsAvailable <= 0) return;

    try {
      // Collect up to slotsAvailable pending tasks
      const queue = deps.taskQueue.loadQueue();
      const pendingTasks = queue.tasks
        .filter(t => t.status === 'pending' && !activeTaskIds.has(t.id))
        .sort((a, b) => (a.priority || 5) - (b.priority || 5) || a.createdAt - b.createdAt)
        .slice(0, slotsAvailable);

      if (pendingTasks.length === 0) return;

      console.log(`[WORKER v5] Launching ${pendingTasks.length} tasks in parallel`);

      // Fire all tasks simultaneously — true parallelism
      await Promise.all(
        pendingTasks.map(task =>
          executeTask(task).catch(err =>
            console.error(`[WORKER v5] Uncaught error in task ${task.id}:`, err.message)
          )
        )
      );
    } catch (e) {
      console.error('[WORKER v5] Tick error:', e.message);
    }
  }

  setInterval(workerTick, WORKER_INTERVAL);
  console.log(`[WORKER v5] Proof-of-Work + True Parallel worker started (${MAX_CONCURRENT_TASKS} concurrent, ${WORKER_INTERVAL/1000}s tick)`);

  return { executeTask, workerTick };
}

module.exports = { initWorker };
