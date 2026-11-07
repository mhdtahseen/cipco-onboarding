// A stand-in for the JSL portal, for testing the robot without touching the real one. It has the same field ids, the same labels and the same habits that matter
// (the alert after Save always says ERROR, the first click of ▲ is ignored, the contractor fills in after the WO box is left, the form shows its requisition number before saving).
// Faults can be switched on in `portal.flags`: swallowSave, doubleSave, lagReports (n reads before a new MRR shows), brokenReport, noContractor, maxLen.
import http from 'node:http';

export function startPortal(flags = {}) {
  const state = { requisitions: [{ no: '05112026-001', items: 'OLD' }, { no: '05112026-002', items: 'OLD' }, { no: '06112026-001', items: 'OLD' }], saves: 0, logins: 0, reportReads: 0, hiddenReads: 0, flags: { maxLen: 100, ...flags }, lastSave: null };
  const nextNo = () => `07112026-${String(state.requisitions.filter((r) => r.no.startsWith('07112026')).length + 4).padStart(3, '0')}`;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const body = await new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d)); });
    if (u.pathname === '/api/login') { state.logins++; res.end('ok'); return; }
    if (u.pathname === '/api/next') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ no: nextNo() })); return; }
    if (u.pathname === '/api/save') {
      state.saves++; const j = JSON.parse(body || '{}'); state.lastSave = j;
      if (!state.flags.swallowSave) { const no = j.no; state.requisitions.push({ no, items: j.items, hiddenFor: state.flags.lagReports || 0 }); if (state.flags.doubleSave) state.requisitions.push({ no: `07112026-${String(Number(no.slice(9)) + 1).padStart(3, '0')}`, items: j.items, hiddenFor: state.flags.lagReports || 0 }); }
      res.end('saved'); return;
    }
    if (u.pathname === '/api/report') {
      state.reportReads++; res.setHeader('content-type', 'application/json');
      const list = state.requisitions.filter((r) => { if (r.hiddenFor > 0) { r.hiddenFor--; state.hiddenReads++; return false; } return true; });
      res.end(JSON.stringify({ broken: !!state.flags.brokenReport || (state.flags.brokenAfterSave && state.saves > 0), rows: list.map((r) => r.no) })); return;
    }
    res.setHeader('content-type', 'text/html'); res.end(PAGE.replaceAll('__MAXLEN__', String(state.flags.maxLen)).replaceAll('__NOCONTRACTOR__', String(!!state.flags.noContractor)));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, state, stop: () => new Promise((r) => server.close(r)) })));
}

const P = 'ContentPlaceHolder1_';
const PAGE = `<!doctype html><meta charset=utf-8><title>Portal</title><body>
<div id=login><form onsubmit="return false"><input id=${P}txtUID><input id=${P}txtPWD type=password><button id=go>Submit</button></form></div>
<div id=app hidden>
  <div><a href="#" id=lnkHome>Home</a> <a href="#" id=lnkMat>Material</a> <a href="#" id=lnkRep>Report</a> <a href="#">Logout</a></div>
  <div id=matHome hidden><button id=addreq>Add Material Requisition</button></div>
  <div id=form hidden><table>
    <tr><td>Material Requisition</td><td><input id=${P}txtReqNo readonly></td></tr>
    <tr><td>Received by:</td><td><select id=${P}ddlReceivedby><option>Select</option><option>By Hand</option><option>By Vehicle</option></select></td></tr>
    <tr><td>Work Order:</td><td><input id=${P}txtWorkorder maxlength=20></td></tr>
    <tr><td>Contractor Name</td><td><input id=${P}txtContractor></td></tr>
    <tr><td>Contractor Address</td><td><input id=${P}txtAddress></td></tr>
    <tr><td>WO Validity</td><td><input id=${P}txtValidity></td></tr>
    <tr><td>Department</td><td><select id=${P}ddlDept><option>--</option><option>MECHANICAL</option><option>ELECTRICAL</option></select></td></tr>
    <tr id=byhand hidden><td>Hand</td><td>
      <input id=${P}txtNoofPersoninH value=0> <button type=button id=${P}txtNoofPersoninH_bUp>▲</button><button type=button id=${P}txtNoofPersoninH_bDn>▼</button>
      <input id=${P}txtPersonName maxlength=__MAXLEN__> <select id=${P}ddlPersonProofid><option value=0>--</option><option value=1>Aadhaar</option><option value=2>Voter ID</option></select> <input id=${P}txtPersonPfoofid maxlength=20></td></tr>
    <tr id=byveh hidden><td>Vehicle</td><td><label><input type=checkbox id=gps> GPS Required</label>
      <input id=${P}txtVehicleNo maxlength=15> <input id=${P}txtDriverName maxlength=__MAXLEN__> <input id=${P}txtDriverDLNo maxlength=20>
      <input id=${P}txtNoofPersonIn value=0> <button type=button id=${P}txtNoofPersonIn_bUp>▲</button><button type=button id=${P}txtNoofPersonIn_bDn>▼</button>
      <select id=${P}ddlIDProofType><option value=0>--</option><option value=1>Aadhaar</option><option value=2>Voter ID</option></select> <input id=${P}txtCoDriverName maxlength=__MAXLEN__> <input id=${P}txtCodriverDLNo maxlength=20></td></tr>
    <tr><td>Material</td><td><input id=${P}txtMaterialnm maxlength=__MAXLEN__> <input id=${P}txtQty> <select id=${P}ddlUnit><option>FT</option><option>Inch</option><option>Kg</option><option>Meter</option><option>mm</option><option>MT</option><option>No</option><option>Pcs</option></select> <input type=button id=${P}ImgAdd value=Add></td></tr>
  </table><div id=${P}pnlMaterial></div><input type=button id=${P}ImgSave value=Save> <input type=button id=${P}ibtn_Close value=Close></div>
  <div id=rep hidden><select id=${P}ddlReportType><option value=1>A</option><option value=2>Material Requisition</option></select><select id=${P}ddltype><option value=1>x</option><option value=4>y</option></select>
    <select id=${P}ddDept><option value=0>All</option><option value=7>MECHANICAL</option></select><input id=${P}txtFrom value="07/11/2026"><input id=${P}txtTo value="07/11/2026"><button id=retr>Retrieve</button><div id=table></div></div>
</div>
<script>
const $=(i)=>document.getElementById(i), P='${P}'; let items=[], upClicks={};
const show=(w)=>{for(const x of ['matHome','form','rep'])$(x).hidden=x!==w;};
$('go').onclick=async()=>{await fetch('/api/login');$('login').hidden=true;$('app').hidden=false;};
$('lnkMat').onclick=(e)=>{e.preventDefault();show('matHome');}; $('lnkRep').onclick=(e)=>{e.preventDefault();show('rep');$('table').innerHTML='';}; $('lnkHome').onclick=(e)=>{e.preventDefault();show('');};
$('addreq').onclick=async()=>{show('form');items=[];upClicks={};$(P+'pnlMaterial').innerHTML='';for(const el of document.querySelectorAll('#form input:not([readonly]):not([type=button]):not([type=checkbox])'))el.value=el.id.includes('NoofPerson')?'0':'';$(P+'ddlReceivedby').value='Select';$('byhand').hidden=$('byveh').hidden=true;$(P+'txtReqNo').value=(await (await fetch('/api/next')).json()).no;};
$(P+'ddlReceivedby').onchange=()=>{$('byhand').hidden=$(P+'ddlReceivedby').value!=='By Hand';$('byveh').hidden=$(P+'ddlReceivedby').value!=='By Vehicle';};
$(P+'txtWorkorder').onblur=()=>{ if(${'__NOCONTRACTOR__'}) return; setTimeout(()=>{ if($(P+'txtWorkorder').value==='1909000093'){$(P+'txtContractor').value='TEST CONTRACTOR LTD';$(P+'txtAddress').value='MUNDRA, GUJARAT';$(P+'txtValidity').value='31/03/2027';}},300);};
for(const b of ['txtNoofPersoninH','txtNoofPersonIn']){ $(P+b+'_bUp').onclick=()=>{ upClicks[b]=(upClicks[b]||0)+1; if(upClicks[b]===1) return; $(P+b).value=String(Number($(P+b).value)+1);}; $(P+b+'_bDn').onclick=()=>{$(P+b).value=String(Math.max(0,Number($(P+b).value)-1));}; }
$(P+'ImgAdd').onclick=()=>{const n=$(P+'txtMaterialnm').value,q=$(P+'txtQty').value; if(!n||!q) return; items.push(n+' x '+q+' '+$(P+'ddlUnit').value); $(P+'pnlMaterial').innerHTML=items.map(i=>'<div>'+i.toUpperCase()+'</div>').join(''); $(P+'txtMaterialnm').value=$(P+'txtQty').value='';};
$(P+'ImgSave').onclick=async()=>{ await fetch('/api/save',{method:'POST',body:JSON.stringify({no:$(P+'txtReqNo').value,items:items.join('; '),by:$(P+'ddlReceivedby').value,wo:$(P+'txtWorkorder').value})}); alert('ERROR'); };
$(P+'ibtn_Close').onclick=()=>show('matHome');
$('retr').onclick=async()=>{ const r=await (await fetch('/api/report')).json(); $('table').innerHTML = r.broken ? '<p>Something went wrong</p>' : '<table><tr><th>Requisition No</th><th>Material Code</th></tr>'+r.rows.map(n=>'<tr><td>'+n+'</td><td>MC-'+n.slice(-3)+'</td></tr>').join('')+'</table>'; };
</script>`;
