import sys
import os

file_path = 'worker.js'
with open(file_path, 'r') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Find the start of Step 5: Intelligent Module Registration & Restart
    if '// Step 5: Intelligent Module Registration & Restart' in line:
        new_lines.append(line)
        i += 1
        # Skip until the restartProcess check
        while i < len(lines) and 'if (restartProcess) {' not in lines[i]:
            new_lines.append(lines[i])
            i += 1
        
        if i < len(lines) and 'if (restartProcess) {' in lines[i]:
            new_lines.append(lines[i])
            i += 1
            
            # Insert the pre-flight validation logic
            validation_logic = """      // Pre-flight validation: check syntax of both files before restarting
      advanceStep(task.id, `Pre-flight validation: node --check ${path.basename(resolvedTargetFile)}...`);
      try {
        execSync(`node --check ${resolvedTargetFile}`, { timeout: 5000, cwd: __dirname });
        if (fs.existsSync(botJsPath)) {
          execSync(`node --check ${botJsPath}`, { timeout: 5000, cwd: __dirname });
        }
        advanceStep(task.id, `Pre-flight validation passed.`);
      } catch (checkErr) {
        const checkMsg = `Pre-flight validation failed: ${checkErr.message}. Aborting restart to prevent crash loop.`;
        advanceStep(task.id, `❌ ${checkMsg}`);
        // Roll back bot.js if we patched it
        if (fs.existsSync(botJsBackup)) fs.copyFileSync(botJsBackup, botJsPath);
        // Roll back the target file
        const backups = fs.readdirSync(path.dirname(resolvedTargetFile))
          .filter(f => f.startsWith(path.basename(resolvedTargetFile) + '.backup.'))
          .sort().reverse();
        if (backups.length > 0) {
          fs.copyFileSync(path.join(path.dirname(resolvedTargetFile), backups[0]), resolvedTargetFile);
        }
        updateTask(task.id, { lastSyntaxError: checkMsg });
        throw new Error(checkMsg);
      }
"""
            new_lines.append(validation_logic)
            continue
    
    new_lines.append(line)
    i += 1

with open(file_path, 'w') as f:
    f.writelines(new_lines)
print("Successfully patched worker.js with pre-flight validation.")
