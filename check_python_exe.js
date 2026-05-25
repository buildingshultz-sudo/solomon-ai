const { executeTool } = require('./tools');
async function run() {
  const res = await executeTool('pc_execute', { command: 'Test-Path "C:\\Program Files\\Python311\\python.exe"' });
  console.log(JSON.stringify(res, null, 2));
}
run();
