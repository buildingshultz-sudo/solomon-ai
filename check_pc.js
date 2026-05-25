const { executeTool } = require('./tools');
async function run() {
  const res = await executeTool('pc_execute', { command: 'Get-ChildItem C:\\' });
  console.log(JSON.stringify(res, null, 2));
}
run();
