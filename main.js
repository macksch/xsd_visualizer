let xsdGlobalTypes = {}, xsdSimpleTypes = {}, xsdComplexTypes = {}, xsdAttributeGroups = {};

function getAttrDoc(attrElem) {
  let doc = '';
  if (!attrElem) return '';
  for (let c of attrElem.children || []) {
    if (c.tagName && c.tagName.match(/annotation$/i)) {
      for (let d of c.children || []) {
        if (d.tagName && d.tagName.match(/documentation$/i)) {
          doc = d.textContent.trim();
        }
      }
    }
  }
  return doc;
}
function getRestrictions(elem) {
  let result = {enum:[], pattern:'', minLength:'', maxLength:'', length:'', raw:[]};
  if (!elem) return result;
  function collectFromRestriction(rest) {
    for (let child of rest.children) {
      if (child.tagName && child.tagName.match(/enumeration$/i)) {
        let val = child.getAttribute('value');
        result.enum.push(val);
      }
      if (child.tagName && child.tagName.match(/pattern$/i)) {
        result.pattern = child.getAttribute('value');
      }
      if (child.tagName && child.tagName.match(/minLength$/i)) {
        result.minLength = child.getAttribute('value');
      }
      if (child.tagName && child.tagName.match(/maxLength$/i)) {
        result.maxLength = child.getAttribute('value');
      }
      if (child.tagName && child.tagName.match(/length$/i)) {
        result.length = child.getAttribute('value');
      }
    }
  }
  if (elem.tagName && elem.tagName.match(/restriction$/i)) {
    collectFromRestriction(elem);
  }
  for (let c of elem.children || []) {
    if (c.tagName && c.tagName.match(/simpleType$/i)) {
      for (let sc of c.children) {
        if (sc.tagName && sc.tagName.match(/restriction$/i)) {
          collectFromRestriction(sc);
        }
      }
    }
    if (c.tagName && c.tagName.match(/restriction$/i)) {
      collectFromRestriction(c);
    }
  }
  return result;
}
function collectGlobalTypes(xsdDoc) {
  xsdGlobalTypes = {}; xsdSimpleTypes = {}; xsdComplexTypes = {}; xsdAttributeGroups = {};
  Array.from(xsdDoc.getElementsByTagNameNS('*','simpleType')).forEach(e=>{
    if (e.hasAttribute('name')) xsdSimpleTypes[e.getAttribute('name')] = e;
  });
  Array.from(xsdDoc.getElementsByTagNameNS('*','complexType')).forEach(e=>{
    if (e.hasAttribute('name')) xsdComplexTypes[e.getAttribute('name')] = e;
  });
  Array.from(xsdDoc.getElementsByTagNameNS('*','attributeGroup')).forEach(e=>{
    if (e.hasAttribute('name')) xsdAttributeGroups[e.getAttribute('name')] = e;
  });
  Object.assign(xsdGlobalTypes, xsdSimpleTypes, xsdComplexTypes);
}
function parseXsdNode(elem, parentChoice=false, parentPath='', typeDepth=0) {
  if (!elem || !elem.tagName) return null;
  const tag = elem.tagName.replace(/^.*:/, '');
  const namedElement = (
    (tag === 'element' || tag === 'attribute')
    && (elem.getAttribute('name') || elem.getAttribute('ref'))
  );
  let restrictions = getRestrictions(elem);
  let node = {
    tag,
    name: elem.getAttribute('name') || elem.getAttribute('ref') || '',
    type: elem.getAttribute('type') || '',
    minOccurs: elem.getAttribute('minOccurs') || '',
    maxOccurs: elem.getAttribute('maxOccurs') || '',
    use: elem.getAttribute('use') || '',
    restriction: '',
    enumeration: restrictions.enum,
    pattern: restrictions.pattern,
    minLength: restrictions.minLength,
    maxLength: restrictions.maxLength,
    length: restrictions.length,
    attributes: [],
    attributeGroups: [],
    attrDocs: {},
    children: [],
    documentation: '',
    isChoice: parentChoice,
    isAll: tag==='all',
    isSequence: tag==='sequence',
    isExtension: tag==='extension',
    inlinedTypeNode: null,
    path: parentPath ? (parentPath + ' » ' + (elem.getAttribute('name')||elem.getAttribute('ref')||'')) : (elem.getAttribute('name')||elem.getAttribute('ref')||''),
    elem
  };
  if (tag === 'annotation' || tag === 'documentation') {
    node.documentation = elem.textContent.trim();
    return node;
  }
  if (tag === 'attribute') {
    node.type = elem.getAttribute('type') || '';
    if (elem.hasAttribute('ref')) node.ref = elem.getAttribute('ref');
    let attrDoc = getAttrDoc(elem);
    if (attrDoc) node.attrDocs[node.name] = attrDoc;
    if (!node.enumeration.length && node.type && xsdSimpleTypes[node.type]) {
      let simple = xsdSimpleTypes[node.type];
      let addRest = getRestrictions(simple);
      node.enumeration = addRest.enum || [];
      node.pattern = addRest.pattern || '';
      node.minLength = addRest.minLength || '';
      node.maxLength = addRest.maxLength || '';
      node.length = addRest.length || '';
    }
  }
  if (tag === 'attributeGroup') {
    node.ref = elem.getAttribute('ref');
  }
  for (let child of elem.children) {
    let childNode = parseXsdNode(child, tag==='choice'||parentChoice, node.path, typeDepth);
    if (!childNode) continue;
    if ((childNode.tag === 'element' || childNode.tag === 'attribute') && (childNode.name)) {
      node.children.push(childNode);
    } else if (childNode.tag === 'attributeGroup') {
      node.attributeGroups.push(childNode.ref || '');
    } else if (childNode.tag === 'annotation' || childNode.tag === 'documentation') {
      node.documentation = childNode.documentation;
    } else {
      if (childNode.children && childNode.children.length)
        node.children.push(...childNode.children);
    }
  }
  if (typeDepth < 5 && node.type && node.type.match(/^[A-Za-z_][\w\-\.]*$/)) {
    let tn = null;
    if (xsdComplexTypes[node.type]) tn = parseXsdNode(xsdComplexTypes[node.type], false, node.path, typeDepth+1);
    else if (xsdSimpleTypes[node.type]) tn = parseXsdNode(xsdSimpleTypes[node.type], false, node.path, typeDepth+1);
    if (tn) node.inlinedTypeNode = tn;
  }
  if (node.attributeGroups && node.attributeGroups.length) {
    node.attributeGroupsExpanded = [];
    for (let agr of node.attributeGroups) {
      if (xsdAttributeGroups[agr]) {
        let agNode = parseXsdNode(xsdAttributeGroups[agr], false, node.path, typeDepth+1);
        if (agNode && agNode.attributes) node.attributeGroupsExpanded.push(...agNode.attributes);
        if (agNode && agNode.attrDocs) Object.assign(node.attrDocs, agNode.attrDocs);
      }
    }
  }
  if (!namedElement && tag !== 'element' && tag !== 'attribute') return node.children.length > 0 ? node : null;
  return node;
}
function extractRootNodes(xsdDoc) {
  const allElements = Array.from(xsdDoc.getElementsByTagNameNS('*','element'));
  return allElements.filter(e => e.parentElement.tagName.endsWith('schema'));
}
function getObligationLabel(node) {
  if (node.tag === 'attribute') {
    if (node.use === 'required')
      return '<span class="attrpflicht">Pflicht</span>';
    else
      return '<span class="attroptional">Optional</span>';
  }
  let minO = node.minOccurs;
  if (minO === '0' || minO == 0) return '<span class="optional">Optional</span>';
  return '<span class="pflicht">Pflicht</span>';
}
function getOccursInline(node) {
  if (node.tag === 'attribute') return '';
  let min = node.minOccurs || '1';
  let max = node.maxOccurs || '1';
  if (max === 'unbounded') max = '∞';
  if (!min && !max) return '';
  if (min == max) return `<span class="occursinline">${min}</span>`;
  return `<span class="occursinline">${min}..${max}</span>`;
}
function renderRestrictions(node, isAttribute=false) {
  let res = '';
  if (node.enumeration && node.enumeration.length > 0) {
    res += `<div class="${isAttribute?'attr-restbox':'restrictionbox'}"><span class="restrictiontitle">Erlaubte Werte:</span>`;
    for (let v of node.enumeration) {
      res += `<span class="restrictionvalue">${v === "" ? "(leer)" : v}</span>`;
    }
    res += `</div>`;
  }
  if (node.pattern) {
    res += `<div class="${isAttribute?'attr-restbox':'restrictionbox'}"><span class="restrictiontitle">Pattern:</span>
      <span class="restrictionvalue">${node.pattern}</span></div>`;
  }
  if (node.minLength || node.maxLength || node.length) {
    res += `<div class="${isAttribute?'attr-restbox':'restrictionbox'}"><span class="restrictiontitle">Länge:</span>`;
    if (node.minLength) res += `min=${node.minLength} `;
    if (node.maxLength) res += `max=${node.maxLength} `;
    if (node.length) res += `fix=${node.length} `;
    res += `</div>`;
  }
  return res;
}
function renderAttributeBlock(attr, attrDocs={}) {
  let html = `<div class="attrcard">
    <div class="attr-header">
      <span class="attr-icon">⚙️</span>
      <span class="attr-badge">Attribut</span>
      <span class="attr-name">${attr.name}</span>
      ${attr.type ? `<span class="attr-type">${attr.type}</span>` : ''}
      ${getObligationLabel(attr)}
    </div>`;
  html += renderRestrictions(attr, true);
  if ((attrDocs||{})[attr.name])
    html += `<div class="attr-doc">${attrDocs[attr.name]}</div>`;
  html += `</div>`;
  return html;
}
function renderNode(node, level=0, parentId='') {
  if (!node) return '';
  if (!node.name) return '';
  if (node.tag === 'attribute') return '';

  let nodeId = parentId + '-' + (node.name||node.type||node.tag) + '-' + Math.floor(Math.random()*1000000);
  let onlyElementChildren = node.children.filter(c => c.tag !== 'attribute');
  let onlyAttributes = node.children.filter(c => c.tag === 'attribute');
  let attrsFromGroups = (node.attributeGroupsExpanded && node.attributeGroupsExpanded.length) ? node.attributeGroupsExpanded : [];
  let allAttrs = [].concat(node.attributes || [], onlyAttributes, attrsFromGroups);

  let hasChildren = (onlyElementChildren && onlyElementChildren.length>0) || (node.inlinedTypeNode);

  let collapsedClass = 'element-block collapsed';
  let html = `<div class="${collapsedClass}" data-nodeid="${nodeId}">`;

  // Header mit Toggle
  html += `<div class="element-header">`;
  if (hasChildren) {
    html += `<span class="toggle" onclick="toggleBlock('${nodeId}')">&#x25B6;</span>`;
  } else {
    html += `<span style="display:inline-block;width:22px"></span>`;
  }
  html += `<span class="element-icon">📦</span>`;
  html += `<span class="element-badge">Element</span>`;
  html += `<span class="element-name">${node.name || ''}</span>`;
  html += getOccursInline(node);
  if (node.type && node.tag === "element") html += `<span class="typelabel">${node.type}</span>`;
  html += getObligationLabel(node);
  html += `</div>`;

  // Restrictions
  html += renderRestrictions(node, false);

  // ATTRIBUTE (eigene Container-Box, direkt UNTER Header, aber VOR Child-Elementen!)
  if (allAttrs.length > 0) {
    html += `<div class="attributes-container">`;
    for (let attr of allAttrs) {
      html += renderAttributeBlock(attr, node.attrDocs);
    }
    html += `</div>`;
  }

  if (node.documentation)
    html += `<div class="doc">${node.documentation}</div>`;

  // Inline-Typdefinition
  if (node.inlinedTypeNode) {
    html += `<div class="typeinfo">
      <span class="typelabel">Typ-Definition für <b>${node.type}</b>:</span>
      ${renderNode(node.inlinedTypeNode, level+1, nodeId + '-inline')}
    </div>`;
  }

  // Child-Elemente
  if (onlyElementChildren.length>0) {
    html += `<div class="children">`;
    for (let child of onlyElementChildren) {
      html += renderNode(child, level+1, nodeId);
    }
    html += `</div>`;
  }
  html += '</div>';
  return html;
}
// Toggle-Funktion
window.toggleBlock = function(nodeId) {
  let blocks = document.querySelectorAll('[data-nodeid="'+nodeId+'"]');
  blocks.forEach(b=>{
    b.classList.toggle('collapsed');
    let t = b.querySelector('.toggle');
    if (t) t.innerHTML = b.classList.contains('collapsed') ? '&#x25B6;' : '&#x25BC;';
  });
};
function collapseAllBlocks() {
  let blocks = document.querySelectorAll('.element-block');
  blocks.forEach(b=>{
    if (!b.classList.contains('collapsed')) b.classList.add('collapsed');
    let t = b.querySelector('.toggle');
    if (t) t.innerHTML = '&#x25B6;';
  });
}
document.getElementById('fileInput').addEventListener('change', function(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    let text = e.target.result;
    let parser = new DOMParser();
    let xsdDoc = parser.parseFromString(text, "application/xml");
    if (xsdDoc.querySelector('parsererror')) {
      document.getElementById('tree').innerHTML = "<b>Fehler beim Parsen der Datei!</b>";
      return;
    }
    collectGlobalTypes(xsdDoc);
    const rootElements = extractRootNodes(xsdDoc);
    if (rootElements.length===0) {
      document.getElementById('tree').innerHTML = "<b>Keine globalen Elemente gefunden.</b>";
      return;
    }
    let html = '';
    for (let elem of rootElements) {
      let node = parseXsdNode(elem, false, '', 0);
      html += renderNode(node, 0, 'root');
    }
    document.getElementById('tree').innerHTML = html;
    collapseAllBlocks();
  };
  reader.readAsText(file);
});