const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const excelPath = path.join(__dirname, '..', '..', 'fe-autosender', 'src', 'assets', 'cleaned_data.xlsx');
const wb = XLSX.readFile(excelPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

// console.log('Total rows:', data.length);
// console.log('Header:', data[0]);

// Generate seeder data
const seederData = [];
for(let i = 1; i < data.length; i++) {
  const row = data[i];
  if (row.length > 0 && row[0]) {
    seederData.push({
      courseName: row[0] || '',
      code: String(row[1]) || '',
      month: Number(row[2]) || 1,
      topicModule: row[3] || '',
      result: row[4] || '',
      skillsAcquired: row[5] || '',
      level: row[6] || ''
    });
  }
}

// console.log();

// Create seeder file
const seederCode = `module.exports = ${JSON.stringify(seederData, null, 2)};`;

fs.writeFileSync(path.join(__dirname, '..', 'prisma', 'seed', 'monthly-templates.seed.ts'), seederCode);
// console.log('\nSeeder file created at: prisma/seed/monthly-templates.seed.ts');
// console.log('Run with: npx ts-node prisma/seed/monthly-templates.seed.ts');
