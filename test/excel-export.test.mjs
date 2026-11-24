import test from 'node:test';
import assert from 'node:assert/strict';
import { createResultsWorkbook } from '../public/excel-export.mjs';
import { publicSnapshot } from '../public/domain.mjs';

function results() {
  return publicSnapshot({
    code: '123456', title: 'Business-Critical Roles Workshop', finished: true, currentRoleId: 'a',
    roles: [{ id: 'a', name: 'Flight Operations', status: 'closed' }, { id: 'b', name: '=1+1 & "Role"', status: 'closed' }, { id: 'c', name: 'Unscored role', status: 'pending' }],
    participants: [{ id: 'p1' }, { id: 'p2' }],
    votes: [{ roleId: 'a', scores: [5, 4, 4, 3, 4, 2] }, { roleId: 'a', scores: [1, 1, 1, 1, 1, 1] }, { roleId: 'b', scores: [5, 5, 5, 5, 5, 5] }],
  });
}

test('Excel export preserves ranking, numeric averages and complete weighted formulas', async () => {
  const workbook = await createResultsWorkbook(results());
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('B8').value, '=1+1 & "Role"');
  assert.equal(sheet.getCell('B8').type, 3); // Text stays text, even when it starts with '='.
  assert.equal(sheet.getCell('C8').value.result, 5);
  assert.equal(sheet.getCell('C9').value.result, 2.5);
  assert.equal(sheet.getCell('D9').value, 2);
  assert.equal(sheet.getCell('C9').value.formula, 'SUMPRODUCT(E9:J9,$E$6:$J$6)');
  assert.deepEqual([5, 6, 7, 8, 9, 10].map(c => sheet.getCell(9, c).value), [3, 2.5, 2.5, 2, 2.5, 1.5]);
  assert.equal(sheet.rowCount, 9); // Unscored roles are excluded.
  assert.equal(sheet.autoFilter, 'A7:J9');
  assert.equal(sheet.views[0].ySplit, 7);
  const buffer = await workbook.xlsx.writeBuffer();
  assert.equal(buffer[0], 0x50); assert.equal(buffer[1], 0x4b); // OOXML ZIP, not renamed CSV.
  const reopened = new globalThis.ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  assert.equal(reopened.worksheets[0].getCell('C9').value.result, 2.5);
  assert.equal(reopened.worksheets[0].getCell('C9').numFmt, '0.00');
});

test('Excel export includes the last of 100 roles and retains tied places', async () => {
  const snapshot = results();
  snapshot.leaderboard = Array.from({ length: 100 }, (_, i) => {
    const score = i < 2 ? 5 : 5 - (i - 1) / 100;
    return { place: i < 2 ? 1 : i + 1, name: `Role ${i + 1}`, score, count: 1, averages: Array(6).fill(score) };
  });
  const workbook = await createResultsWorkbook(snapshot);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('A8').value.result, sheet.getCell('A9').value.result);
  assert.match(sheet.getCell('A107').value.formula, /\$C\$107/);
  assert.equal(sheet.getCell('B107').value, 'Role 100');
  assert.equal(sheet.autoFilter, 'A7:J107');
});

test('empty Excel exports fail with a useful message', async () => {
  await assert.rejects(createResultsWorkbook({ leaderboard: [] }), /no scored roles/);
});
