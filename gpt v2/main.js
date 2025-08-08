'use strict';

const AppState = {
  xsdDoc: null,
  globals: { simple:{}, complex:{}, attrGroups:{}, all:{} },
  options: { expandInitially:false, showCommaSeparatedEnums:true, maxTypeInlineDepth:5 }
};

// Helpers
const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
const el = (t,p={})=>Object.assign(document.createElement(t), p);

// Parsing
const Parse = (()=>{
  const getDocFrom = (node)=>{
    if (!node) return '';
    for (const c of node.children||[]) if (/annotation$/i.test(c.tagName)) for (const d of c.children||[]) if (/documentation$/i.test(d.tagName)) return d.textContent.trim();
    return '';
  };

  const getRestrictions = (elem)=>{
    const r = { enum:[], pattern:'', minLength:'', maxLength:'', length:'' };
    if (!elem) return r;
    const collect = (rest)=>{
      for (const c of rest.children||[]) {
        if (/enumeration$/i.test(c.tagName)) r.enum.push(c.getAttribute('value'));
        if (/pattern$/i.test(c.tagName)) r.pattern = c.getAttribute('value')||'';
        if (/minLength$/i.test(c.tagName)) r.minLength = c.getAttribute('value')||'';
        if (/maxLength$/i.test(c.tagName)) r.maxLength = c.getAttribute('value')||'';
        if (/length$/i.test(c.tagName)) r.length = c.getAttribute('value')||'';
      }
    };
    if (/restriction$/i.test(elem.tagName)) collect(elem);
    for (const c of elem.children||[]) {
      if (/simpleType$/i.test(c.tagName)) for (const sc of c.children||[]) if (/restriction$/i.test(sc.tagName)) collect(sc);
      if (/restriction$/i.test(c.tagName)) collect(c);
    }
    return r;
  };

  const getRestrictionBase = (node)=>{
    const rest = node.querySelector(':scope > restriction, :scope > * > restriction');
    return rest ? (rest.getAttribute('base') || '') : '';
  };

  const collectGlobals = (doc)=>{
    const simple={}, complex={}, attrGroups={}, all={};
    for (const e of doc.getElementsByTagNameNS('*','simpleType')) if (e.hasAttribute('name')) simple[e.getAttribute('name')] = e;
    for (const e of doc.getElementsByTagNameNS('*','complexType')) if (e.hasAttribute('name')) complex[e.getAttribute('name')] = e;
    for (const e of doc.getElementsByTagNameNS('*','attributeGroup')) if (e.hasAttribute('name')) attrGroups[e.getAttribute('name')] = e;
    Object.assign(all, simple, complex);
    return { simple, complex, attrGroups, all };
  };

  const schemaRoots = (doc)=> Array.from(doc.getElementsByTagNameNS('*','element')).filter(e=> e.parentElement && /schema$/i.test(e.parentElement.tagName));

  function parseNode(elem, parentChoice=false, parentPath='', depth=0) {
    if (!elem?.tagName) return null;
    const tag = elem.tagName.replace(/^.*:/,'');
    const named = ((tag==='element'||tag==='attribute') && (elem.getAttribute('name')||elem.getAttribute('ref')));

    const r = getRestrictions(elem);
    const n = {
      tag,
      name: elem.getAttribute('name')||elem.getAttribute('ref')||'',
      type: elem.getAttribute('type')||'',
      minOccurs: elem.getAttribute('minOccurs')||'',
      maxOccurs: elem.getAttribute('maxOccurs')||'',
      use: elem.getAttribute('use')||'',
      enumeration: r.enum, pattern: r.pattern, minLength:r.minLength, maxLength:r.maxLength, length:r.length,
      attributes: [], attributeGroups: [], attrDocs: {}, children: [], documentation:'',
      isChoice: parentChoice, isAll: tag==='all', isSequence: tag==='sequence', inlinedTypeNode:null,
      path: parentPath ? `${parentPath} » ${elem.getAttribute('name')||elem.getAttribute('ref')||''}` : (elem.getAttribute('name')||elem.getAttribute('ref')||''),
      elem
    };

    if (tag==='annotation' || tag==='documentation') { n.documentation = elem.textContent.trim(); return n; }

    if (tag==='attribute') {
      n.type = elem.getAttribute('type')||'';
      if (elem.hasAttribute('ref')) n.ref = elem.getAttribute('ref');
      const adoc = getDocFrom(elem);
      if (adoc) n.attrDocs[n.name] = adoc; // Attribute‑Annotation anzeigen
      if (!n.enumeration.length && n.type && AppState.globals.simple[n.type]) {
        const st = AppState.globals.simple[n.type];
        const extra = getRestrictions(st);
        Object.assign(n, { enumeration:extra.enum||[], pattern:extra.pattern||'', minLength:extra.minLength||'', maxLength:extra.maxLength||'', length:extra.length||'' });
      }
    }

    if (tag==='attributeGroup') n.ref = elem.getAttribute('ref');

    for (const c of elem.children||[]) {
      const cn = parseNode(c, tag==='choice'||parentChoice, n.path, depth);
      if (!cn) continue;
      if ((cn.tag==='element'||cn.tag==='attribute') && cn.name) n.children.push(cn);
      else if (cn.tag==='attributeGroup') n.attributeGroups.push(cn.ref||'');
      else if (cn.tag==='annotation'||cn.tag==='documentation') n.documentation = cn.documentation;
      else if (cn.children?.length) n.children.push(...cn.children);
    }

    // inline type expansion
    if (depth < AppState.options.maxTypeInlineDepth && n.type && /^[A-Za-z_][\w\-.]*$/.test(n.type)) {
      let tn = null;
      if (AppState.globals.complex[n.type]) tn = parseNode(AppState.globals.complex[n.type], false, n.path, depth+1);
      else if (AppState.globals.simple[n.type]) tn = parseNode(AppState.globals.simple[n.type], false, n.path, depth+1);
      if (tn) n.inlinedTypeNode = tn;
    }

    // expand attribute groups (incl. docs)
    if (n.attributeGroups?.length) {
      n.attributeGroupsExpanded = [];
      for (const g of n.attributeGroups) {
        const ag = AppState.globals.attrGroups[g];
        if (!ag) continue;
        const gn = parseNode(ag, false, n.path, depth+1);
        if (gn?.attributes) n.attributeGroupsExpanded.push(...gn.attributes);
        if (gn?.attrDocs) Object.assign(n.attrDocs, gn.attrDocs);
      }
    }

    if (!named && tag!=='element' && tag!=='attribute') return n.children.length ? n : null;
    return n;
  }

  return { getDocFrom, getRestrictions, getRestrictionBase, collectGlobals, schemaRoots, parseNode };
})();

// Render
const Render = (()=>{
  const obligation = (n)=> n.tag==='attribute' ? (n.use==='required' ? '<span class="mandatory">Mandatory</span>' : '<span class="optional">Optional</span>') : ((n.minOccurs==='0'||n.minOccurs==0)?'<span class="optional">Optional</span>':'<span class="mandatory">Mandatory</span>');
  const occurs = (n)=> n.tag==='attribute'? '' : (()=>{ let mi=n.minOccurs||'1', ma=n.maxOccurs||'1'; if (ma==='unbounded') ma='∞'; return mi==ma?`<span class="occurs">${mi}</span>`:`<span class="occurs">${mi}..${ma}</span>`; })();
  const restBox = (n, isAttr=false)=>{
    let h='';
    if (n.enumeration?.length) {
      const joined = AppState.options.showCommaSeparatedEnums ? n.enumeration.map(v=>v===''?'(empty)':v).join(', ') : n.enumeration.map(v=>`<span class="val">${v===''?'(empty)':v}</span>`).join('');
      h += `<div class="${isAttr?'attr-rest':'restrictionbox'}"><span class="title">Allowed values:</span> ${joined}</div>`;
    }
    if (n.pattern) h += `<div class="${isAttr?'attr-rest':'restrictionbox'}"><span class="title">Pattern:</span> <span class="val">${n.pattern}</span></div>`;
    if (n.minLength||n.maxLength) h += `<div class="${isAttr?'attr-rest':'restrictionbox'}"><span class="title">Length:</span> ${n.minLength?`min=${n.minLength}`:''} ${n.maxLength?`max=${n.maxLength}`:''}</div>`;
    return h;
  };

  const attr = (a, docs={})=>{
    let h = `<div class="attr">
      <div class="ahead">
        <span class="badge-attr">Attribute</span>
        <span class="attr-name">${a.name}</span>
        ${a.type?`<span class="attr-type">${a.type}</span>`:''}
        ${obligation(a)}
      </div>`;
    h += restBox(a, true);
    if ((docs||{})[a.name]) h += `<div class="attr-doc">${docs[a.name]}</div>`; // <- Annotation sichtbar
    return h + `</div>`;
  };

  const node = (n, level=0, pid='')=>{
    if (!n?.name || n.tag==='attribute') return '';
    const id = `${pid}-${(n.name||n.type||n.tag)}-${Math.floor(Math.random()*1e6)}`;
    const elems = n.children.filter(c=>c.tag!=='attribute');
    const attrs = [].concat(n.attributes||[], n.children.filter(c=>c.tag==='attribute'), n.attributeGroupsExpanded||[]);
    const hasChildren = elems?.length || n.inlinedTypeNode;

    let h = `<div class="block collapsed" data-nodeid="${id}">
      <div class="header">
        ${hasChildren?`<button class="toggle" aria-expanded="false" aria-controls="${id}-children" onclick="window.__toggle('${id}')" type="button">▸</button>`:`<span class="toggle" aria-hidden="true" style="visibility:hidden">▸</span>`}
        <span class="icon">📦</span>
        <span class="badge-elem">Element</span>
        <span class="name">${n.name}</span>
        ${occurs(n)}
        ${n.type && n.tag==='element'?`<span class="type-label">${n.type}</span>`:''}
        ${obligation(n)}
      </div>`;

    h += restBox(n, false);

    if (attrs.length) { h += `<div class="attrs">${attrs.map(a=>attr(a, n.attrDocs)).join('')}</div>`; }

    if (n.documentation) h += `<div class="attr-doc" style="margin-left:4px">${n.documentation}</div>`;

    if (n.inlinedTypeNode) h += `<div class="typeinfo"><span class="type-label">Type definition for <b>${n.type}</b>:</span>${node(n.inlinedTypeNode, level+1, `${id}-inline`)}</div>`;

    if (elems.length) h += `<div class="children" id="${id}-children">${elems.map(c=>node(c, level+1, id)).join('')}</div>`;

    return h + `</div>`;
  };

  // SimpleTypes Catalog
  const simpleTypeCard = (name, elem)=>{
    const doc = Parse.getDocFrom(elem) || '';
    const base = Parse.getRestrictionBase(elem) || '';
    const r = Parse.getRestrictions(elem);
    const enumJoined = r.enum.length ? r.enum.map(v=>v===''?'(empty)':v).join(', ') : '';
    let h = `<article class="st-card">
      <div><span class="st-name">${name}</span>${base?` — <span class="st-base">base: ${base}</span>`:''}</div>`;
    if (enumJoined) h += `<div class="st-rest"><b>Allowed values:</b> ${enumJoined}</div>`;
    if (r.pattern) h += `<div class="st-rest"><b>Pattern:</b> <code>${r.pattern}</code></div>`;
    if (r.minLength || r.maxLength) h += `<div class="st-rest"><b>Length:</b> ${r.minLength?`min=${r.minLength}`:''} ${r.maxLength?`max=${r.maxLength}`:''}</div>`;
    if (doc) h += `<div class="st-doc">${doc}</div>`;
    return h + `</article>`;
  };

  const simpleTypesCatalog = (simpleMap)=>{
    const names = Object.keys(simpleMap).sort((a,b)=>a.localeCompare(b));
    if (!names.length) return `<div class="st-header">No global simpleTypes found.</div>`;
    return `<div class="st-header">SimpleTypes (${names.length})</div><div class="st-grid">${names.map(n=>simpleTypeCard(n, simpleMap[n])).join('')}</div>`;
  };

  return { node, simpleTypesCatalog };
})();

// Interactions
window.__toggle = function(id){ const blk = document.querySelector(`[data-nodeid="${id}"]`); if(!blk) return; blk.classList.toggle('collapsed'); const btn = blk.querySelector('.toggle'); if(btn){ const exp = !blk.classList.contains('collapsed'); btn.setAttribute('aria-expanded', String(exp)); btn.textContent = exp ? '▾' : '▸'; }};
function collapseAll(){ $$('.block').forEach(b=>{ if(!b.classList.contains('collapsed')) b.classList.add('collapsed'); const t=b.querySelector('.toggle'); if(t){ t.setAttribute('aria-expanded','false'); t.textContent='▸'; } }); }
function expandAll(){ $$('.block').forEach(b=>{ if(b.classList.contains('collapsed')) b.classList.remove('collapsed'); const t=b.querySelector('.toggle'); if(t){ t.setAttribute('aria-expanded','true'); t.textContent='▾'; } }); }

// File + Rendering
function setError(msg){ const e=$('#error'); e.textContent=msg; e.classList.remove('hidden'); }
function clearError(){ const e=$('#error'); e.classList.add('hidden'); e.textContent=''; }

async function handleFile(file){ clearError(); try { const text = await file.text(); const doc = new DOMParser().parseFromString(text,'application/xml'); if (doc.querySelector('parsererror')) throw new Error('Failed to parse XML.'); AppState.xsdDoc = doc; AppState.globals = Parse.collectGlobals(doc); renderAll(); } catch(err){ console.error(err); setError(err.message||'Unknown error.'); } }

function renderAll(){
  const roots = Parse.schemaRoots(AppState.xsdDoc);
  $('#tree').innerHTML = roots.map(r=> Render.node(Parse.parseNode(r, false, '', 0), 0, 'root')).join('') || '<div class="panel panel-info">No global elements found.</div>';
  $('#simpleTypes').innerHTML = Render.simpleTypesCatalog(AppState.globals.simple);
  if (!AppState.options.expandInitially) collapseAll();
}

function init(){
  const fileInput = $('#fileInput');
  const drop = $('#dropzone');
  const btnCollapse = $('#collapseAll');
  const btnExpand = $('#expandAll');
  const btnCatalog = $('#toggleCatalog');

  fileInput.addEventListener('change', (e)=>{ const f=e.target.files?.[0]; if(f) handleFile(f); });

  // Drag & drop
  ;['dragenter','dragover'].forEach(ev=> drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.add('dragover'); }));
  ;['dragleave','drop'].forEach(ev=> drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', e=>{ const f=e.dataTransfer?.files?.[0]; if(f) handleFile(f); });

  btnCollapse.addEventListener('click', collapseAll);
  btnExpand.addEventListener('click', expandAll);
  btnCatalog.addEventListener('click', ()=>{
    const elCat = $('#simpleTypes');
    const isHidden = elCat.classList.toggle('hidden');
    btnCatalog.setAttribute('aria-pressed', (!isHidden).toString());
    btnCatalog.textContent = isHidden ? 'Show simpleTypes' : 'Hide simpleTypes';
  });
}

document.addEventListener('DOMContentLoaded', init);