const { executeTool } = require('./tools');
async function run() {
  const res = await executeTool('pc_execute', { command: 'Test-Path "$env:TEMP\\python-installer.exe"' });
  console.log(JSON.stringify(res, null, 2));
}
run();
