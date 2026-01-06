/**
 * Export Utilities
 * Helper functions for generating Excel and CSV files
 */

const XLSX = require('xlsx');

/**
 * Generate Excel file from data array
 * @param {Array} data - Array of objects to export
 * @param {string} filename - Name of the file (without extension)
 * @returns {Buffer} - Excel file buffer
 */
function generateExcel(data, filename = 'export') {
  if (!data || data.length === 0) {
    throw new Error('No data to export');
  }

  // Create a new workbook
  const wb = XLSX.utils.book_new();
  
  // Convert array of objects to worksheet
  const ws = XLSX.utils.json_to_sheet(data);
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  
  // Generate buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  
  return buffer;
}

/**
 * Generate CSV string from data array
 * @param {Array} data - Array of objects to export
 * @returns {string} - CSV string
 */
function generateCSV(data) {
  if (!data || data.length === 0) {
    throw new Error('No data to export');
  }

  // Get headers from first object
  const headers = Object.keys(data[0]);
  
  // Create CSV rows
  const rows = data.map(row => 
    headers.map(header => {
      const value = row[header];
      // Handle values that contain commas, quotes, or newlines
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value || '';
    })
  );
  
  // Combine headers and rows
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
  
  return csvContent;
}

module.exports = {
  generateExcel,
  generateCSV
};

