const { executeTool } = require('./tools');

async function test() {
  console.log('--- Testing Anthropic Batch API Tools ---');
  
  // 1. Create a batch task
  console.log('Test: Create Batch Task');
  const createRes = await executeTool('create_batch_task', {
    custom_id: 'test_batch_' + Date.now(),
    prompt: 'Please output a single word: "SOLOMON_BATCH_TEST_SUCCESS"',
    purpose: 'Integration testing for Solomon V4 Batch API'
  });
  console.log('Result:', createRes);

  if (createRes.ok) {
    const batchId = createRes.batch_id;
    
    // 2. Check batch status
    console.log('\nTest: Check Batch Status');
    const statusRes = await executeTool('check_batch_status', {
      batch_id: batchId
    });
    console.log('Result:', statusRes);
    
    // 3. Try to get results (should fail if not ended)
    console.log('\nTest: Get Batch Results (Immediate)');
    const resultsRes = await executeTool('get_batch_results', {
      batch_id: batchId
    });
    console.log('Result:', resultsRes);
  }
}

test().catch(console.error);
