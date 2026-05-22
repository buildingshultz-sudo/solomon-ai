/**
 * patch_register_modules.js
 * Adds require() for stripe-tools.js and app-deployer.js in bot.js,
 * and passes them to the worker as available tools.
 */
const fs = require('fs');
const path = require('path');

const BOT_FILE = path.join(__dirname, 'bot.js');
let code = fs.readFileSync(BOT_FILE, 'utf8');

// 1. Add requires after the existing require block (after ironedit-commands require)
const AFTER_REQUIRE = "const { registerIronEditCommands } = require('./ironedit-commands');";
const NEW_REQUIRES = `const { registerIronEditCommands } = require('./ironedit-commands');
const stripeTools = require('./stripe-tools');
const appDeployer = require('./app-deployer');`;

if (code.includes('stripeTools')) {
  console.log('SKIP: stripe-tools already required in bot.js');
} else if (code.includes(AFTER_REQUIRE)) {
  code = code.replace(AFTER_REQUIRE, NEW_REQUIRES);
  console.log('✅ Added require() for stripe-tools and app-deployer');
} else {
  console.log('ERROR: Could not find ironedit-commands require line');
  process.exit(1);
}

// 2. Pass the modules to the worker via workerDeps
const OLD_WORKER_DEPS = `  const workerDeps = {
    taskQueue: taskQueueModule,
    knowledgeBase: { loadKB, addToKB },
    core: { callLLM, webSearch, executeOnPC, safeSend }
  };`;

const NEW_WORKER_DEPS = `  const workerDeps = {
    taskQueue: taskQueueModule,
    knowledgeBase: { loadKB, addToKB },
    core: { callLLM, webSearch, executeOnPC, safeSend },
    modules: { stripeTools, appDeployer }
  };`;

if (code.includes(OLD_WORKER_DEPS)) {
  code = code.replace(OLD_WORKER_DEPS, NEW_WORKER_DEPS);
  console.log('✅ Added modules to workerDeps');
} else if (code.includes('modules: { stripeTools')) {
  console.log('SKIP: modules already in workerDeps');
} else {
  console.log('ERROR: Could not find workerDeps block');
  process.exit(1);
}

// 3. Add /stripe and /deploy command handlers
// Find a good insertion point — after the IRONEDIT registration
const AFTER_IRONEDIT = "  console.log('[IRONEDIT] Pipeline commands registered');";
const COMMAND_HANDLERS = `  console.log('[IRONEDIT] Pipeline commands registered');

  // ─── STRIPE COMMANDS ──────────────────────────────────────────────────────
  bot.onText(/\\/stripe_balance/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== config.OWNER_CHAT_ID.toString()) return;
    const result = await stripeTools.getBalance();
    if (result.error) return safeSend(bot, chatId, '❌ ' + result.error);
    await safeSend(bot, chatId, \`💰 *Stripe Balance*\\n\\nAvailable: \${result.available}\\nPending: \${result.pending}\`);
  });

  bot.onText(/\\/stripe_charges(?:\\s+(\\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== config.OWNER_CHAT_ID.toString()) return;
    const limit = parseInt(match[1]) || 10;
    const result = await stripeTools.listRecentCharges(limit);
    if (result.error) return safeSend(bot, chatId, '❌ ' + result.error);
    const lines = result.charges.map(c => \`• \${c.amount} — \${c.description} (\${c.status})\`).join('\\n');
    await safeSend(bot, chatId, \`💳 *Recent Charges (\${result.total})*\\n\\n\${lines}\`);
  });

  bot.onText(/\\/stripe_link\\s+(.+?)\\s+(\\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== config.OWNER_CHAT_ID.toString()) return;
    const productName = match[1];
    const priceInCents = parseInt(match[2]);
    const result = await stripeTools.createPaymentLink(productName, priceInCents);
    if (result.error) return safeSend(bot, chatId, '❌ ' + result.error);
    await safeSend(bot, chatId, \`🔗 *Payment Link Created*\\n\\nProduct: \${productName}\\nAmount: \${result.amount}\\nLink: \${result.url}\`);
  });

  // ─── APP DEPLOYER COMMANDS ────────────────────────────────────────────────
  bot.onText(/\\/deploy\\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== config.OWNER_CHAT_ID.toString()) return;
    const args = match[1].split('|').map(s => s.trim());
    const appName = args[0];
    const description = args[1] || '';
    await safeSend(bot, chatId, \`🚀 Scaffolding *\${appName}*...\`);
    const result = appDeployer.scaffoldNextApp(appName, description);
    if (result.error) return safeSend(bot, chatId, '❌ ' + result.error);
    // Init git
    const gitResult = appDeployer.initGitRepo(result.path);
    const gitMsg = gitResult.success ? '\\n✅ Git initialized' : '\\n⚠️ Git: ' + gitResult.error;
    await safeSend(bot, chatId, \`✅ *App Scaffolded: \${appName}*\\n\\nPath: \${result.path}\\nFiles: \${result.files}\${gitMsg}\\n\\nNext: \${result.nextStep}\`);
  });

  console.log('[MODULES] Stripe + App Deployer commands registered');`;

if (code.includes('[MODULES] Stripe + App Deployer commands registered')) {
  console.log('SKIP: Command handlers already registered');
} else if (code.includes(AFTER_IRONEDIT)) {
  code = code.replace(AFTER_IRONEDIT, COMMAND_HANDLERS);
  console.log('✅ Registered /stripe and /deploy command handlers');
} else {
  console.log('ERROR: Could not find IRONEDIT registration line');
  process.exit(1);
}

fs.writeFileSync(BOT_FILE, code, 'utf8');
console.log('✅ bot.js updated with stripe-tools and app-deployer integration');
