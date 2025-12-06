const fs = require('fs');

const files = [
  
  './automation/complete_automation.js'
];

files.forEach(file => {
  try {
    const workflow = require(file);

    if (!workflow || typeof workflow !== 'object') {
      console.warn(`⚠ Skipped: ${file} — not exporting an object.`);
      return;
    }

    const filename = workflow.name.replace(/ /g, '_') + '.json';
    fs.writeFileSync(`./automation/${filename}`, JSON.stringify(workflow, null, 2));

    console.log(`✔ Exported: ${filename}`);
  } catch (err) {
    console.error(`❌ Failed to process ${file}:`, err.message);
  }
});