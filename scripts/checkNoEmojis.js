import fs from 'fs';
import path from 'path';

const emojiRegex = /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D|[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55])/gu;

const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'storage']);

function walk(dir) {
  let results = [];
  for (const file of fs.readdirSync(dir)) {
    if (ignoredDirs.has(file)) continue;
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(walk(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

const files = walk('.');
let violations = 0;

for (const file of files) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const match = line.match(emojiRegex);
      if (match) {
        console.error(`[EMOJI VIOLATION] ${file}:${idx + 1} - Found emoji: ${match.join(', ')}`);
        violations++;
      }
    });
  } catch (err) {
    // Ignore unreadable binary files
  }
}

if (violations > 0) {
  console.error(`[ERROR] Total emoji violations found: ${violations}. Emojis are strictly forbidden in this project.`);
  process.exit(1);
} else {
  console.log('[SUCCESS] No emojis detected across the codebase.');
  process.exit(0);
}
