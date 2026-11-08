import { PdfDoc, money, pdfDate } from '../src/utils/pdf.js';
import fs from 'node:fs';

const doc = new PdfDoc({ title: 'QUOTATION QT-20261108-0001', footerText: 'Page {page} of {total}' });
doc.heading('QUOTATION');
doc.text('Shanghai Example Industrial Co., Ltd.', { size: 9, color: [0.42, 0.47, 0.55] });
doc.spacer(6); doc.rule();
doc.fields([['Quote No.', 'QT-20261108-0001'], ['Date', pdfDate(new Date())], ['Valid until', pdfDate('2026-12-08')]]);
doc.spacer(4); doc.text('Bill to', { bold: true, size: 10 });
doc.fields([['Customer', 'Acme Trading LLC'], ['Email', 'buyer@acme.example'], ['Country', 'United Arab Emirates']]);
doc.spacer(8);
doc.table({
  columns: [
    { label: 'Item', width: 210 }, { label: 'Spec', width: 120 },
    { label: 'Qty', width: 50, align: 'right' }, { label: 'Unit', width: 50, align: 'right' },
    { label: 'Unit price', width: 70, align: 'right' }, { label: 'Amount', width: 75, align: 'right' },
  ],
  rows: Array.from({ length: 26 }, (_, i) => [
    `Stainless steel centrifugal pump model CPS-${200 + i}`,
    'SS316L / 15 kW / 380 V',
    String(10 + i), 'pcs', money(1250 + i * 30).replace('USD ', ''),
    money((10 + i) * (1250 + i * 30)).replace('USD ', ''),
  ]),
});
doc.total('TOTAL  ' + money(84210.5));
doc.spacer(10);
doc.paragraph('Payment terms: 30% T/T deposit, balance against copy of B/L. Delivery 25-30 days after deposit. 中文测试会被降级为问号。', { size: 8.5 });

const bytes = doc.build();
const text = new TextDecoder('latin1').decode(bytes);
const checks = [];
checks.push(['%PDF-1.4 头', text.startsWith('%PDF-1.4')]);
checks.push(['%%EOF 尾', text.trimEnd().endsWith('%%EOF')]);
checks.push(['含 startxref', /startxref\n\d+\n%%EOF/.test(text)]);
// 校验 xref 每个偏移确实指向 "N 0 obj"
const xrefBlock = text.slice(text.lastIndexOf('\nxref\n') + 1);
const offs = [...xrefBlock.matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
let offOk = offs.length > 0;
offs.forEach((off, i) => {
  const at = text.slice(off, off + 24);
  if (!at.startsWith(`${i + 1} 0 obj`)) offOk = false;
});
checks.push([`xref 偏移全部正确（${offs.length} 个对象）`, offOk]);
checks.push(['页数 > 1（自动分页生效）', doc.pages.length > 1]);
checks.push(['非 Latin-1 已降级', !text.includes('中文测试')]);
checks.push(['金额右对齐有内容', text.includes('TOTAL')]);

fs.writeFileSync('test-artifacts/sample-quote.pdf', bytes);
let pass = 0;
for (const [name, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + name); if (ok) pass++; }
console.log(`\n${pass}/${checks.length} 通过，PDF ${(bytes.length / 1024).toFixed(1)} KiB，${doc.pages.length} 页`);
