const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const FILE = 'docs/frontend/design-proposal/mis-portal-prototype.html';
const html = fs.readFileSync(FILE, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.scrollTo = () => {};
    window.addEventListener('error', e => errors.push('window.error: ' + (e.error ? e.error.stack : e.message)));
  }
});
const { window } = dom;

function run(code) {
  try { return { ok: true, value: window.eval(code) }; }
  catch (e) { return { ok: false, error: e.stack || String(e) }; }
}

window.addEventListener('load', () => setTimeout(() => {
  const results = [];
  const pageIds = run("Object.keys(saPAGES)");
  if (!pageIds.ok) { console.log('FAIL get saPAGES:', pageIds.error); finish(); return; }
  const ids = pageIds.value;

  // A) per-page list render + form open
  for (const id of ids) {
    const r = run(`(function(){
      var el = document.getElementById('sa-content');
      if (!el) { el = document.createElement('div'); el.id='sa-content'; document.body.appendChild(el); }
      saSelectPage(${JSON.stringify(id)});
      var len = document.getElementById('sa-content').innerHTML.length;
      saOpenForm('create');
      var sheetLen = document.getElementById('sa-sheet-body').innerHTML.length;
      var hasFormFields = document.getElementById('sa-sheet-body').querySelectorAll('input,select,textarea').length;
      saCloseSheet();
      var rows = saEnsureData(${JSON.stringify(id)});
      var editLen = 0, editFields = 0;
      if (rows.length) { saOpenForm('edit', rows[0]); editLen = document.getElementById('sa-sheet-body').innerHTML.length; editFields = document.getElementById('sa-sheet-body').querySelectorAll('input,select,textarea').length; saCloseSheet(); }
      return { len: len, sheetLen: sheetLen, hasFormFields: hasFormFields, editLen: editLen, editFields: editFields, readonly: !!saPAGES[${JSON.stringify(id)}].readonly };
    })()`);
    if (!r.ok) { results.push({ id, error: r.error }); continue; }
    results.push(Object.assign({ id }, r.value));
  }

  // B) full CRUD on a representative non-readonly page ('org')
  const crud = {};
  const ensure = "var el=document.getElementById('sa-content'); if(!el){el=document.createElement('div'); el.id='sa-content'; document.body.appendChild(el);} saSelectPage('org');";
  const fill = `document.querySelectorAll('#sa-sheet-body [data-key]').forEach(function(el){
    if (el.tagName==='SELECT'){ var o=el.querySelector('option'); if(o) el.value=o.value; }
    else if (el.type==='checkbox'){ el.checked=true; }
    else if (el.type==='number'){ el.value='1'; }
    else { el.value='测试值'; }
  });`;
  // create
  let s = run(ensure + " saOpenForm('create');"); crud.openCreate = s.ok ? 'ok' : s.error;
  if (s.ok) {
    const before = run("saEnsureData('org').length").value;
    const sv = run(fill + " document.getElementById('sa-sheet-save').click();");
    crud.createSave = sv.ok ? 'ok' : sv.error;
    const after = run("saEnsureData('org').length").value;
    crud.createCount = before + ' -> ' + after;
    crud.createAddedRow = (after === before + 1);
  }
  // edit first row
  s = run(ensure + " var rows=saEnsureData('org'); saOpenForm('edit', rows[0]);"); crud.openEdit = s.ok ? 'ok' : s.error;
  if (s.ok) {
    const sv = run(fill + " document.getElementById('sa-sheet-save').click();");
    crud.editSave = sv.ok ? 'ok' : sv.error;
  }
  // delete first row
  const beforeDel = run("saEnsureData('org').length").value;
  s = run(ensure + " var rows=saEnsureData('org'); saAskDelete(rows[0]);");
  crud.askDelete = s.ok ? 'ok' : s.error;
  if (s.ok) {
    const d = run("document.getElementById('sa-confirm-ok').click();");
    crud.delete = d.ok ? 'ok' : d.error;
    const afterDel = run("saEnsureData('org').length").value;
    crud.deleteCount = beforeDel + ' -> ' + afterDel;
    crud.deleteRemovedRow = (afterDel === beforeDel - 1);
  }

  // C) wiring: enterSubsystem + activateNav
  const wiring = [];
  const enter = run("enterSubsystem('system')");
  if (!enter.ok) { wiring.push({ note: 'enterSubsystem failed: ' + enter.error }); }
  else {
    const navs = run(`(function(){ var s=subsystems.find(function(x){return x.id==='system';}); var out=[]; s.nav.forEach(function(n){ if(n.children) n.children.forEach(function(c){ if(c.saId) out.push(c.label); }); else if(n.saId) out.push(n.label); }); return out; })()`);
    if (navs.ok) {
      for (const label of navs.value) {
        const w = run(`(function(){ activateNav(${JSON.stringify(label)}); var el=document.getElementById('sa-content'); var html=el?el.innerHTML:''; var sub=document.getElementById('sub-content'); var subHtml=sub?sub.innerHTML:''; return { htmlLen: html.length, hasBreadcrumb: subHtml.indexOf('breadcrumb')>=0, hasTable: html.indexOf('<table')>=0 }; })()`);
        wiring.push({ label, ok: w.ok, data: w.ok ? w.value : w.error });
      }
    } else wiring.push({ note: 'nav enumeration failed: ' + navs.error });
  }

  // report
  console.log('=== A) Engine render + form-open per page ===');
  let aFail = 0;
  results.forEach(r => {
    if (r.error) { aFail++; console.log('  FAIL', r.id, '\n', r.error); return; }
    const listOk = r.len > 200, createOk = r.readonly ? true : (r.sheetLen > 50 && r.hasFormFields > 0), editOk = r.readonly || (r.editLen > 50 && r.editFields > 0);
    const ok = listOk && createOk && editOk; if (!ok) aFail++;
    console.log('  ' + (ok ? 'OK ' : 'XX ') + r.id.padEnd(9) + ' list=' + r.len + ' create=' + r.sheetLen + '(f' + r.hasFormFields + ')' + ' edit=' + r.editLen + '(f' + r.editFields + ')' + (r.readonly ? ' [ro]' : ''));
  });

  console.log('=== B) CRUD on org ===');
  let bFail = 0;
  ['openCreate','createSave','createAddedRow','openEdit','editSave','askDelete','delete','deleteRemovedRow'].forEach(k => {
    const v = crud[k]; const ok = (v === 'ok' || v === true); if (!ok && k!=='createCount' && k!=='deleteCount') bFail++;
    console.log('  ' + k + ': ' + v);
  });

  console.log('=== C) Portal wiring ===');
  let cFail = 0;
  wiring.forEach(w => {
    if (w.note) { console.log('  ' + w.note); return; }
    if (!w.ok) { cFail++; console.log('  XX ' + w.label + ' :: ' + w.data); return; }
    const ok = w.data.htmlLen > 200 && w.data.hasBreadcrumb && w.data.hasTable; if (!ok) cFail++;
    console.log('  ' + (ok ? 'OK ' : 'XX ') + w.label.padEnd(5) + ' htmlLen=' + w.data.htmlLen + ' breadcrumb=' + w.data.hasBreadcrumb + ' table=' + w.data.hasTable);
  });

  console.log('=== Runtime errors ===');
  if (!errors.length) console.log('  (none)'); else errors.forEach(e => console.log('  ' + e));
  console.log('SUMMARY engineFail=' + aFail + ' crudFail=' + bFail + ' wiringFail=' + cFail + ' runtimeErrors=' + errors.length);
  finish();
}, 300));

function finish() { dom.window.close(); }
