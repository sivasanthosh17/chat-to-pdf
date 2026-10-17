/**
 * csv.js — RFC 4180 CSV with spreadsheet formula-injection protection.
 *
 * A cell that starts with = + - @ (or tab / carriage return) could be run as
 * a formula when the file is opened in Excel or Sheets, so it is prefixed
 * with an apostrophe. Fields with commas, quotes or line breaks are quoted.
 */

function cell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {Array<{ header: string, value: (row) => unknown }>} columns
 * @param {object[]} rows
 * @returns {string} CSV text with a UTF-8 BOM (so Excel shows Unicode correctly)
 */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
