// design-ir — the one representation every tool speaks.
//
// Why an IR at all: the reader has three possible sources (REST, Figma plugin,
// .fig), the generator has three targets (Web, Compose, SwiftUI) and the scorer
// must compare a rendering against the design. Without a shared representation
// that is 3x3 bespoke conversions; with it, each side is written once.
//
// Design decisions:
//  - absolute geometry is kept, because fidelity is measured in pixels
//  - layout intent (auto-layout) is kept separately, because generators need it
//  - every node keeps its Figma id so any finding can be traced back
//  - colours are resolved to tokens when possible, raw hex otherwise

export const IR_VERSION = 1;

/**
 * @typedef {Object} IRNode
 * @property {string} id            source node id (e.g. "4060:27805")
 * @property {string} name
 * @property {string} role          frame | text | image | vector | instance
 * @property {{x,y,w,h}} box        absolute, in design px
 * @property {IRStyle} style
 * @property {IRLayout} [layout]    auto-layout intent when present
 * @property {string} [text]        text content for role=text
 * @property {string} [component]   component key when this is an instance
 * @property {IRNode[]} children
 */

/**
 * @typedef {Object} IRStyle
 * @property {string} [fill]        #RRGGBB or token name
 * @property {number} [opacity]
 * @property {number} [radius]
 * @property {{w:number,color:string}} [border]
 * @property {Object} [font]        {family,size,weight,lineHeight,letterSpacing,align,color}
 * @property {boolean} [clip]
 */

/**
 * @typedef {Object} IRLayout
 * @property {"row"|"column"} direction
 * @property {number} gap
 * @property {{t:number,r:number,b:number,l:number}} padding
 * @property {string} [justify]
 * @property {string} [align]
 */

export function emptyDocument(meta = {}) {
  return {
    irVersion: IR_VERSION,
    meta: { source: null, fileKey: null, exportedAt: null, ...meta },
    tokens: { colors: {}, fonts: {}, spacing: [] },
    screens: [],      // { id, name, size:{w,h}, platform, root: IRNode }
    components: [],   // { key, name, usages: [nodeId], signature }
  };
}

/** A stable, comparable signature of a node's visual structure. */
export function signatureOf(node) {
  const parts = [node.role];
  if (node.style?.font) parts.push("f" + node.style.font.size + "/" + (node.style.font.weight || 400));
  if (node.style?.fill) parts.push(node.style.fill);
  if (node.style?.radius) parts.push("r" + node.style.radius);
  parts.push("c" + (node.children?.length || 0));
  return parts.join("|");
}
