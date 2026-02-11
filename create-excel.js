import XLSX from 'xlsx';
import fs from 'fs';

// Read CSV data
const csvContent = fs.readFileSync('./data/hitch-compatibility.csv', 'utf8');
const rows = csvContent.trim().split('\n').map(row => row.split(','));

// Create workbook and worksheet
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);

// Set column widths
ws['!cols'] = [
  { wch: 15 }, // make
  { wch: 15 }, // model
  { wch: 12 }, // year_from
  { wch: 12 }, // year_to
  { wch: 15 }, // variant
  { wch: 15 }, // has_2inch_hitch
  { wch: 50 }  // notes
];

// Add worksheet to workbook
XLSX.utils.book_append_sheet(wb, ws, 'Hitch Compatibility');

// Write to file
XLSX.writeFile(wb, './data/hitch-compatibility.xlsx');

console.log('Excel file created: data/hitch-compatibility.xlsx');
