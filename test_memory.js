const { nativeMem } = require('./memory');
const { executeTool } = require('./tools');

async function test() {
  console.log('--- Testing Native Memory Tool Interface ---');
  
  // 1. Create a memory
  console.log('Test: Create');
  const createRes = await executeTool('memory_manage', {
    command: 'create',
    path: '/memories/test_memory.txt',
    file_text: 'This is a test memory content.'
  });
  console.log('Result:', createRes);

  // 2. View directory
  console.log('\nTest: View Directory');
  const viewDirRes = await executeTool('memory_manage', {
    command: 'view',
    path: '/memories'
  });
  console.log('Result:', viewDirRes);

  // 3. View file
  console.log('\nTest: View File');
  const viewFileRes = await executeTool('memory_manage', {
    command: 'view',
    path: '/memories/test_memory.txt'
  });
  console.log('Result:', viewFileRes);

  // 4. String replace
  console.log('\nTest: String Replace');
  const replaceRes = await executeTool('memory_manage', {
    command: 'str_replace',
    path: '/memories/test_memory.txt',
    old_str: 'test memory content',
    new_str: 'updated memory content'
  });
  console.log('Result:', replaceRes);

  // 5. Insert
  console.log('\nTest: Insert');
  const insertRes = await executeTool('memory_manage', {
    command: 'insert',
    path: '/memories/test_memory.txt',
    insert_line: 1,
    insert_text: 'Inserted line.\n'
  });
  console.log('Result:', insertRes);

  // 6. View final
  console.log('\nTest: View Final');
  const viewFinalRes = await executeTool('memory_manage', {
    command: 'view',
    path: '/memories/test_memory.txt'
  });
  console.log('Result:', viewFinalRes);

  // 7. Rename
  console.log('\nTest: Rename');
  const renameRes = await executeTool('memory_manage', {
    command: 'rename',
    old_path: '/memories/test_memory.txt',
    new_path: '/memories/renamed_memory.txt'
  });
  console.log('Result:', renameRes);

  // 8. Delete
  console.log('\nTest: Delete');
  const deleteRes = await executeTool('memory_manage', {
    command: 'delete',
    path: '/memories/renamed_memory.txt'
  });
  console.log('Result:', deleteRes);
}

test().catch(console.error);
