'use strict';
// install_whisper.js — Install local Whisper on Jed's PC via pc_execute (Direct Python Download)
// Run on VPS: node install_whisper.js

const { executeTool } = require('./tools');

async function run() {
  console.log('=== Whisper Installation on Jed\'s PC ===\n');

  // Step 0: Check Python version
  console.log('Step 0: Checking Python version on PC...');
  let pyCheck = await executeTool('pc_execute', {
    command: 'python --version 2>&1; python3 --version 2>&1',
    timeout_ms: 15000
  });

  let hasPython = pyCheck.ok && (
    (pyCheck.stdout || '').toLowerCase().includes('python') ||
    (pyCheck.output || '').toLowerCase().includes('python') ||
    (pyCheck.stderr || '').toLowerCase().includes('python 3')
  );

  if (!hasPython) {
    console.log('❌ Python not found. Downloading and installing Python 3.11.9 silently...');
    const downloadCmd = 'Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe" -OutFile "$env:TEMP\\python-installer.exe"';
    const installCmd = 'Start-Process -FilePath "$env:TEMP\\python-installer.exe" -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait';
    
    console.log('Downloading installer...');
    await executeTool('pc_execute', { command: downloadCmd, timeout_ms: 120000 });
    
    console.log('Running silent installation (Wait for ~2 mins)...');
    await executeTool('pc_execute', { command: installCmd, timeout_ms: 300000 });
    
    console.log('Waiting 10 seconds for environment update...');
    await new Promise(r => setTimeout(r, 10000));

    // Re-check Python
    console.log('Re-checking Python...');
    pyCheck = await executeTool('pc_execute', {
      command: 'python --version 2>&1; python3 --version 2>&1',
      timeout_ms: 15000
    });
    hasPython = pyCheck.ok && (
      (pyCheck.stdout || '').toLowerCase().includes('python') ||
      (pyCheck.output || '').toLowerCase().includes('python')
    );
  }

  let pyCmd = 'python';
  if (!hasPython) {
    console.log('⚠️  Python still not in PATH. Checking default installation paths...');
    const checkPaths = [
      'C:\\Program Files\\Python311\\python.exe',
      'C:\\Python311\\python.exe',
      'C:\\Program Files (x86)\\Python311\\python.exe',
      `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python311\\python.exe`
    ];
    
    for (const p of checkPaths) {
      const pCheck = await executeTool('pc_execute', {
        command: `if (Test-Path "${p}") { echo "EXISTS" }`,
        timeout_ms: 10000
      });
      if ((pCheck.stdout || pCheck.output || '').includes('EXISTS')) {
        console.log(`✅ Found Python at: ${p}`);
        pyCmd = `"${p}"`;
        hasPython = true;
        break;
      }
    }
  }

  if (!hasPython) {
    console.log('❌ Python installation failed or still not found. Manual intervention required.');
    process.exit(1);
  }

  console.log(`Using Python command: ${pyCmd}`);

  // Step 2: Check if whisper is already installed
  console.log('\nStep 2: Checking if Whisper is already installed...');
  const whisperCheck = await executeTool('pc_execute', {
    command: `${pyCmd} -c "import whisper; print('whisper_installed:', whisper.__version__)" 2>&1`,
    timeout_ms: 20000
  });
  const whisperOut = whisperCheck.stdout || whisperCheck.output || '';
  if (whisperOut.includes('whisper_installed:')) {
    console.log('✅ Whisper already installed:', whisperOut.trim());
  } else {
    // Step 3: Install openai-whisper
    console.log('\nStep 3: Installing openai-whisper (local, offline)...');
    const installResult = await executeTool('pc_execute', {
      command: `${pyCmd} -m pip install openai-whisper 2>&1`,
      timeout_ms: 300000
    });
    console.log('Install output (last 300 chars):', (installResult.stdout || installResult.output || '').slice(-300));
  }

  // Step 4: Verify installation
  console.log('\nStep 4: Verifying Whisper installation...');
  const verifyResult = await executeTool('pc_execute', {
    command: `${pyCmd} -c "import whisper; print('OK: whisper version', whisper.__version__)" 2>&1`,
    timeout_ms: 30000
  });
  const verifyOut = verifyResult.stdout || verifyResult.output || '';
  console.log('Verify result:', verifyOut.trim());

  if (verifyOut.includes('OK:')) {
    console.log('✅ Whisper verified successfully!');
    return { installed: true, version: verifyOut.trim() };
  } else {
    console.log('❌ Whisper verification failed:', verifyOut.trim());
    process.exit(1);
  }
}

run().then(result => {
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}).catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
