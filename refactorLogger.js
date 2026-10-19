const fs = require('fs');
const path = require('path');

const baseDir = __dirname;
const foldersToRefactor = ['controllers', 'models', 'middlewares', 'services', 'cron', 'routes'];

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Skip if already requires logger
  if (content.includes('utils/logger')) {
      // Still might need replacements if they didn't finish
  }

  let updatedContent = content;
  
  // Replace console.error with logger.error
  updatedContent = updatedContent.replace(/console\.error\(/g, 'logger.error(');
  
  // Replace console.log with logger.info
  updatedContent = updatedContent.replace(/console\.log\(/g, 'logger.info(');
  
  // Replace console.warn with logger.warn
  updatedContent = updatedContent.replace(/console\.warn\(/g, 'logger.warn(');

  if (updatedContent !== content) {
    // Needs the logger import
    if (!updatedContent.includes('utils/logger')) {
      // calculate relative path
      let relPath = path.relative(path.dirname(filePath), path.join(baseDir, 'utils', 'logger'));
      relPath = relPath.replace(/\\/g, '/');
      if (!relPath.startsWith('.')) relPath = './' + relPath;

      const importStatement = `const logger = require("${relPath}");\n`;
      
      // Inject at the top, after the first few requires or at line 1
      updatedContent = importStatement + updatedContent;
    }
    fs.writeFileSync(filePath, updatedContent, 'utf8');
    console.log('[Refactored]', filePath);
  }
}

function traverseDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      traverseDir(fullPath);
    } else if (fullPath.endsWith('.js')) {
      processFile(fullPath);
    }
  }
}

foldersToRefactor.forEach(folder => {
  const fullFolderPath = path.join(baseDir, folder);
  if (fs.existsSync(fullFolderPath)) {
    traverseDir(fullFolderPath);
  }
});

console.log('Refactoring complete.');
