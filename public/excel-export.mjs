import { CRITERIA } from './domain.mjs';

const NAVY = 'FF102E47', BLUE = 'FF1668BF', PALE = 'FFEAF3FE';
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const font = (bold = false, color = NAVY, size = 11) => ({ name: 'Arial', size, bold, color: { argb: color } });
const formula = (expression, result) => ({ formula: expression, result });
const BAR_COLOURS = ['1668BF', '78A9DF', '24786A', '79B8A8', 'E8CF70', 'F4E7A4'];

export async function createResultsWorkbook(snapshot, { exportedAt = new Date() } = {}) {
  if (!snapshot.leaderboard?.length) throw new Error('There are no scored roles to export yet.');
  // Load the writer only when an export is requested; no external service is used.
  await import('./vendor/exceljs.min.js');
  const workbook = new globalThis.ExcelJS.Workbook();
  workbook.creator = 'Rolelab | Air Astana';
  workbook.created = exportedAt;
  workbook.modified = exportedAt;
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet('Role ranking', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 7, showGridLines: false, zoomScale: 85 }],
    pageSetup: { paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [8, 46, 20, 13, 23, 23, 23, 23, 23, 23].map(width => ({ width, style: { font: font(), alignment: { vertical: 'middle', wrapText: true } } }));
  for (const [row, text, size] of [
    [1, 'AIR ASTANA | SUCCESSION PLANNING', 11],
    [3, 'Prioritised role list', 22],
    [4, snapshot.title?.trim() === 'Калибровка бизнес-ролей' ? 'Business-Critical Roles Workshop' : snapshot.title, 12],
    [5, 'The score supports discussion. It does not replace judgement or functional evidence.', 10],
  ]) {
    sheet.mergeCells(row, 1, row, 10);
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.font = font(row !== 4 && row !== 5, row === 1 ? 'FFFFFFFF' : NAVY, size);
    if (row === 1) cell.fill = fill(NAVY);
    sheet.getRow(row).height = row === 3 ? 34 : 26;
  }
  sheet.mergeCells('A6:D6');
  sheet.getCell('A6').value = 'DIMENSION WEIGHTS';
  sheet.getCell('A6').font = font(true, BLUE, 10);
  CRITERIA.forEach((criterion, i) => {
    const cell = sheet.getCell(6, 5 + i);
    cell.value = criterion.weight / 100;
    cell.numFmt = '0%';
    cell.font = font(true, BLUE);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.note = `${criterion.description}\nSource: Business-Critical Roles Workshop V2, slide 8. Weights total 100%.`;
  });
  const headers = ['Rank', 'Role title', 'Weighted score\n(1–5)', 'Responses', ...CRITERIA.map(c => c.title.replace(' and ', '\nand ').replace(' / ', ' /\n'))];
  headers.forEach((header, i) => {
    const cell = sheet.getCell(7, i + 1);
    cell.value = header;
    cell.font = font(true, 'FFFFFFFF', 10);
    cell.fill = fill(NAVY);
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: i === 1 ? 'left' : 'center' };
  });
  sheet.getRow(7).height = 78;
  const last = 7 + snapshot.leaderboard.length;
  snapshot.leaderboard.forEach((role, i) => {
    const row = 8 + i;
    const values = [
      formula(`1+SUMPRODUCT(--($C$8:$C$${last}>C${row}+1E-10))`, role.place),
      role.name, formula(`SUMPRODUCT(E${row}:J${row},$E$6:$J$6)`, role.score), role.count, ...role.averages,
    ];
    values.forEach((value, j) => {
      const cell = sheet.getCell(row, j + 1);
      cell.value = value;
      cell.fill = fill(j === 2 ? PALE : i % 2 ? 'FFF5F7FA' : 'FFFFFFFF');
      cell.font = font(j === 2 || role.place <= 3, j === 2 ? BLUE : NAVY);
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: j === 1 ? 'left' : 'center' };
      if (j >= 4) cell.alignment = { ...cell.alignment, horizontal: 'right', indent: 1 };
      if (j === 2 || j >= 4) cell.numFmt = '0.00';
    });
    sheet.getRow(row).height = Math.max(34, Math.ceil(role.name.length / 42) * 16 + 10);
  });
  const theme = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  CRITERIA.forEach((criterion, i) => {
    // Follow the website palette, including future colour changes.
    const cssColour = theme?.getPropertyValue(`--color-chart-${criterion.id}`).trim();
    const colour = /^#[0-9a-f]{6}$/i.test(cssColour || '') ? cssColour.slice(1).toUpperCase() : BAR_COLOURS[i];
    const column = String.fromCharCode(69 + i);
    sheet.addConditionalFormatting({ ref: `${column}8:${column}${last}`, rules: [{
      type: 'dataBar', cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 5 }],
      color: { argb: `FF${colour}` }, showValue: true, gradient: false, border: false,
      minLength: 0, maxLength: 70, // Leave space for the numeric score on the right.
    }] });
  });
  sheet.getCell('A7').note = 'Ranks use unrounded scores; scores within 1E-10 share a rank, matching Rolelab.';
  sheet.getCell('C7').note = 'Weighted score = sum of each dimension average × its weight. Only closed roles with submitted scores are included. Source: workshop group results at export time.';
  sheet.autoFilter = `A7:J${last}`;
  sheet.pageSetup.printArea = `A1:J${last}`;
  sheet.pageSetup.printTitlesRow = '6:7';
  return workbook;
}
