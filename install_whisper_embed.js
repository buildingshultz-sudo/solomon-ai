'use strict';
const { executeTool } = require('./tools');

async function run() {
  console.log('=== Whisper Installation (Embeddable Python) ===\n');

  try {
    console.log('Step 1: Downloading embeddable Python...');
    await executeTool('pc_execute', { 
      command: 'Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip" -OutFile "C:/python-embed.zip"',
      timeout_ms: 180000 
    });

    console.log('Step 2: Extracting to C:/Python311-Embed...');
    await executeTool('pc_execute', { 
      command: 'Expand-Archive -Path "C:/python-embed.zip" -DestinationPath "C:/Python311-Embed" -Force',
      timeout_ms: 120000 
    });

    console.log('Step 3: Enabling site-packages (removing ._pth file)...');
    await executeTool('pc_execute', { 
      command: 'Remove-Item "C:/Python311-Embed/python311._pth" -ErrorAction SilentlyContinue',
      timeout_ms: 10000 
    });

    console.log('Step 4: Installing pip...');
    await executeTool('pc_execute', { 
      command: 'Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile "C:/Python311-Embed/get-pip.py"',
      timeout_ms: 60000 
    });
    const pipResult = await executeTool('pc_execute', { 
      command: 'C:/Python311-Embed/python.exe C:/Python311-Embed/get-pip.py',
      timeout_ms: 180000 
    });
    console.log('Pip result:', pipResult.ok ? 'Success' : 'Failed');

    console.log('Step 5: Installing openai-whisper...');
    const whisperResult = await executeTool('pc_execute', { 
      command: 'C:/Python311-Embed/python.exe -m pip install openai-whisper',
      timeout_ms: 300000 
    });

    if (whisperResult.ok) {
      console.log('✅ Whisper installed successfully via embeddable Python!');
      return { ok: true, path: 'C:/Python311-Embed/python.exe' };
    } else {
      console.log('❌ Whisper installation failed.');
      return { ok: false };
    }
  } catch (e) {
    console.error('Error during installation:', e);
    return { ok: false, error: e.message };
  }
}

run().then(res => console.log(JSON.stringify(res))).catch(console.error);
