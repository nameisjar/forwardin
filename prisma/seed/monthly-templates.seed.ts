import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

export async function seedMonthlyTemplates() {
  // console.log('🌱 Seeding Monthly Templates from Excel...');

  try {
    // Path ke file Excel (absolute path)
    const excelFilePath = path.resolve(__dirname, './seedfile/monthly_template.xlsx');
    
    // console.log(`📂 Reading Excel file from: ${excelFilePath}`);
    
    // Baca file Excel
    const workbook = XLSX.readFile(excelFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON array
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // console.log(`📋 Header Row:`, rows[0]);
    
    // Skip header row (index 0)
    const dataRows = rows.slice(1).filter(row => row && row.length >= 7);
    
    // console.log(`📊 Found ${dataRows.length} rows in Excel file`);
    
    // Hapus data lama
    const deleteResult = await prisma.monthlyTemplate.deleteMany({});
    // console.log(`🗑️  Cleared ${deleteResult.count} existing monthly templates`);
    
    let successCount = 0;
    let errorCount = 0;
    
    // Insert data ke database
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      try {
        // Clean data dan handle special characters
        const courseName = String(row[0] || '').trim().replace(/[""]/g, '"');
        const code = String(row[1] || '').trim();
        const month = Number(row[2]) || 1;
        const topicModule = String(row[3] || '').trim().replace(/[\r\n]+/g, ' ');
        const result = String(row[4] || '').trim();
        const skillsAcquired = String(row[5] || '').trim();
        const level = String(row[6] || '').trim();
        
        await prisma.monthlyTemplate.create({
          data: {
            courseName,
            code,
            month,
            topicModule,
            result,
            skillsAcquired,
            level
          }
        });
        
        successCount++;
        
        if ((successCount % 10) === 0) {
          // console.log(`✅ Inserted ${successCount}/${dataRows.length} templates...`);
        }
        
      } catch (error: any) {
        // console.error(`❌ Error inserting row ${i + 2}:`, {
        //   courseName: row[0],
        //   code: row[1],
        //   month: row[2],
        //   error: error.message
        // });
        errorCount++;
      }
    }
    
    // console.log(`\n✅ Successfully seeded ${successCount} monthly templates`);
    if (errorCount > 0) {
      // console.log(`⚠️  Failed to insert ${errorCount} records`);
    }
    
  } catch (error: any) {
    // console.error('❌ Error seeding monthly templates:', error.message);
    throw error;
  }
}

// Run seeder jika dijalankan langsung
if (require.main === module) {
  seedMonthlyTemplates()
    .then(() => {
      // console.log('✨ Monthly templates seeding completed!');
      process.exit(0);
    })
    .catch((error) => {
      // console.error('💥 Seeding failed:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}