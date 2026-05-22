import sys
import os

file_path = 'worker.js'
with open(file_path, 'r') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Find the start of the restartProcess block
    if 'if (restartProcess) {' in line:
        # Move botJsPath and botJsBackup declarations ABOVE the pre-flight validation block
        new_lines.append(line)
        new_lines.append("      let botJsPatched = false;\n")
        new_lines.append("      const botJsPath = path.join(__dirname, 'bot.js');\n")
        new_lines.append("      const botJsBackup = botJsPath + '.backup.' + Date.now();\n")
        i += 1
        
        # Skip the original declarations later in the file
        while i < len(lines):
            curr = lines[i]
            if 'let botJsPatched = false;' in curr or \
               'const botJsPath = path.join(__dirname, \'bot.js\');' in curr or \
               'const botJsBackup = botJsPath + \'.backup.\' + Date.now();' in curr:
                i += 1
                continue
            new_lines.append(curr)
            i += 1
            if 'advanceStep(task.id, `Restarting ${restartProcess}...`);' in curr:
                break
        continue
    
    new_lines.append(line)
    i += 1

with open(file_path, 'w') as f:
    f.writelines(new_lines)
print("Successfully fixed botJsBackup scoping in worker.js.")
