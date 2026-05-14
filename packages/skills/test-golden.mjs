import { loadGoldenSet } from './dist/golden/index.js';

try {
  const skills = loadGoldenSet();
  console.log(`✓ Loaded ${skills.length} golden skills\n`);
  
  let mismatchCount = 0;
  skills.forEach((skill, idx) => {
    const { filename, parsed } = skill;
    const tools = parsed.frontmatter.tools;
    
    // Extract tools used in the body
    const usedToolsMatch = parsed.body.match(/Use `(search|bash)`/g) || [];
    const usedTools = [...new Set(usedToolsMatch.map(m => m.match(/`([^`]+)`/)[1]))];
    
    const declared = new Set(tools);
    const _used = new Set(usedTools);
    
    let match = '✓';
    if (usedTools.some(t => !declared.has(t))) {
      match = '✗ MISMATCH';
      mismatchCount++;
    }
    
    console.log(`${idx + 1}. ${filename} ${match}`);
    console.log(`   Declared: [${tools.join(', ')}]`);
    if (usedTools.length > 0) {
      console.log(`   Used: [${usedTools.join(', ')}]`);
    }
  });
  
  if (mismatchCount > 0) {
    console.log(`\n⚠️  ${mismatchCount} file(s) have mismatches between declared and used tools`);
    process.exit(1);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
