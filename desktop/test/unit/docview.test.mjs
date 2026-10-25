import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../zip.mjs';
import { columnName, supports, toHtml, unzip } from '../../src/main/docview.ts';

const W = 'xmlns:w="w" xmlns:r="r" xmlns:a="a"';

test('supported formats', () => {
  for (const f of ['a.docx', 'B.XLSX', 'c.pptx', 'd.odt', 'e.ods', 'f.odp', 'g.csv']) assert.ok(supports(f), f);
  for (const f of ['a.doc', 'b.xls', 'c.pdf', 'noext']) assert.ok(!supports(f), f);
});

test('unzip: stored and deflated entries', () => {
  assert.equal(unzip(zip({ 'a.txt': 'hello' }, false)).get('a.txt').toString(), 'hello');
  assert.equal(unzip(zip({ 'a.txt': 'привет'.repeat(100) })).get('a.txt').toString(), 'привет'.repeat(100));
});

test('DOCX: headings, bold/italic/underline, lists, tables, images, escaping', () => {
  const doc = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title &amp; more</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve"> it</w:t></w:r><w:r><w:t>&lt;script&gt;</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>one</w:t></w:r></w:p><w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>two</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>
  </w:body></w:document>`;
  const rels = '<Relationships><Relationship Id="rId5" Target="media/image1.png"/></Relationships>';
  const html = toHtml(zip({ 'word/document.xml': doc, 'word/_rels/document.xml.rels': rels, 'word/media/image1.png': Buffer.from([137, 80, 78, 71]) }), 'r.docx');
  assert.match(html, /<h1>Title &amp; more<\/h1>/);
  assert.match(html, /<b>bold<\/b><i><u> it<\/u><\/i>&lt;script&gt;/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<table><tr><td><p>A1<\/p><\/td><td><p>B1<\/p><\/td><\/tr><\/table>/);
  assert.match(html, /<img src="data:image\/png;base64,iVBORw==">/);
  assert.ok(!html.includes('<script>'));
});

test('XLSX: all sheets, shared strings, booleans, column letters', () => {
  const wb = '<workbook><sheets><sheet name="Plan" r:id="rId1"/><sheet name="Facts" r:id="rId2"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>';
  const ss = '<sst><si><t>Name</t></si><si><r><t>Ve</t></r><r><t>ra</t></r></si></sst>';
  const s1 = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row><row r="3"><c r="B3" t="s"><v>1</v></c><c r="D3" t="b"><v>1</v></c></row></sheetData></worksheet>';
  const s2 = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>';
  const html = toHtml(zip({ 'xl/workbook.xml': wb, 'xl/_rels/workbook.xml.rels': rels, 'xl/sharedStrings.xml': ss, 'xl/worksheets/sheet1.xml': s1, 'xl/worksheets/sheet2.xml': s2 }), 'b.xlsx');
  assert.match(html, /<h2>Plan<\/h2>.*<h2>Facts<\/h2>/s);
  assert.match(html, /<th>A<\/th><th>B<\/th><th>C<\/th><th>D<\/th>/);
  assert.match(html, /<tr><th>1<\/th><td>Name<\/td><td><\/td><td>42<\/td><td><\/td><\/tr>/);
  assert.match(html, /<tr><th>3<\/th><td><\/td><td>Vera<\/td><td><\/td><td>TRUE<\/td><\/tr>/);
  assert.match(html, /<td>x<\/td>/);
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
});

test('PPTX: slides in order, first paragraph is the heading', () => {
  const sl = (t, b) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p><a:p><a:r><a:t>${b}</a:t></a:r></a:p></p:sld>`;
  const html = toHtml(zip({ 'ppt/slides/slide10.xml': sl('Ten', 'x'), 'ppt/slides/slide2.xml': sl('Two', 'y') }), 'd.pptx');
  assert.ok(html.indexOf('Two') < html.indexOf('Ten'));
  assert.match(html, /<div class="slide"><h3>2<\/h3><h2>Two<\/h2><p>y<\/p><\/div>/);
});

test('ODT/ODS: headings, paragraphs, tables', () => {
  const content = '<office:document-content><office:body><text:h>Head</text:h><text:p>Line<text:tab/>tab</text:p>' +
    '<table:table><table:table-row><table:table-cell><text:p>1</text:p></table:table-cell></table:table-row></table:table></office:body></office:document-content>';
  const html = toHtml(zip({ 'content.xml': content }), 'e.odt');
  assert.match(html, /<h2>Head<\/h2><p>Line&emsp;tab<\/p>/);
  assert.match(html, /<table><tr><td><p>1<\/p><\/td><\/tr><\/table>/);
});

test('CSV: separator detection, quotes, header row', () => {
  const html = toHtml(Buffer.from('﻿name;city\n"Ivanov; I.";"Moscow ""C"""\r\nB;<x>'), 'f.csv');
  assert.match(html, /<tr><th>name<\/th><th>city<\/th><\/tr>/);
  assert.match(html, /<td>Ivanov; I\.<\/td><td>Moscow &quot;C&quot;<\/td>/);
  assert.match(html, /<td>&lt;x&gt;<\/td>/);
  assert.match(toHtml(Buffer.from('a,b\n1,2'), 'g.csv'), /<td>1<\/td><td>2<\/td>/);
});

test('broken or unknown files give null', () => {
  assert.equal(toHtml(Buffer.from('not a zip'), 'x.docx'), null);
  assert.equal(toHtml(zip({ 'other.xml': '<a/>' }), 'x.docx'), null);
  assert.equal(toHtml(Buffer.from('x'), 'x.doc'), null);
});

test('zip bomb: total unpacked size is limited, the document is refused quickly', () => {
  const zero = Buffer.alloc(39 * 1024 * 1024);
  const files = { 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>' };
  for (let i = 0; i < 6; i++) files[`word/media/big${i}.png`] = zero;
  const rels = '<Relationships>' + Array.from({ length: 6 }, (_, i) => `<Relationship Id="r${i}" Target="media/big${i}.png"/>`).join('') + '</Relationships>';
  files['word/_rels/document.xml.rels'] = rels;
  files['word/document.xml'] = '<w:document><w:body>' + Array.from({ length: 6 }, (_, i) => `<w:p><w:r><a:blip r:embed="r${i}"/></w:r></w:p>`).join('') + '</w:body></w:document>';
  const t0 = Date.now();
  assert.equal(toHtml(zip(files), 'bomb.docx'), null);
  assert.ok(Date.now() - t0 < 5000);
});

test('zip bomb: unreferenced big entries are not unpacked at all', () => {
  const files = { 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>ok</w:t></w:r></w:p></w:body></w:document>' };
  for (let i = 0; i < 30; i++) files[`junk/${i}.bin`] = Buffer.alloc(39 * 1024 * 1024);
  const t0 = Date.now();
  assert.match(toHtml(zip(files), 'junk.docx'), /<p>ok<\/p>/);
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
});
