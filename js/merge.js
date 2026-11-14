// Fusión de tres vías de las canciones y capítulos de una playlist, para cuando dos personas (o dos
// dispositivos) la cambian a la vez: `base` es la última versión común, `mine` la de aquí y
// `theirs` la que llegó de Supabase. Se conservan los cambios de los dos lados: lo que uno añade se
// añade, lo que uno quita se quita y, si solo uno de los dos reordenó, vale su orden.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const secs = list => (list || []).map(({ id, name, description, collapsed }) => ({ id, name: name || '', description: description || '', collapsed: !!collapsed }));
const norm = x => ({ trackIds: [...(x.trackIds || [])], trackSection: { ...(x.trackSection || {}) }, added: { ...(x.added || {}) }, sections: secs(x.sections) });

/** Lo que se fusiona de una playlist (copia). */
export const listsOf = norm;

export function mergeLists(base, mine, theirs) {
  base = norm(base); mine = norm(mine); theirs = norm(theirs);
  const eq = (a, b) => same(a.trackIds, b.trackIds) && same(a.trackSection, b.trackSection) && same(a.sections, b.sections);
  if (eq(theirs, base)) return mine;
  if (eq(mine, base)) return theirs;

  // capítulos: los de ellos, sin los que quité yo, con mis cambios de nombre y los que añadí
  const bS = new Map(base.sections.map(s => [s.id, s])), mS = new Map(mine.sections.map(s => [s.id, s]));
  const sections = theirs.sections.filter(s => !(bS.has(s.id) && !mS.has(s.id)))
    .map(s => { const b = bS.get(s.id), m = mS.get(s.id); return m && b && !same(m, b) ? m : s; });
  for (const s of mine.sections) if (!bS.has(s.id) && !sections.some(x => x.id === s.id)) sections.push(s);

  // canciones
  const bT = new Set(base.trackIds), mT = new Set(mine.trackIds), tT = new Set(theirs.trackIds);
  const reordered = (x, xs) => !same(x.trackIds.filter(id => bT.has(id)), base.trackIds.filter(id => xs.has(id)));
  const [primary, other, otherSet] = reordered(theirs, tT) || !reordered(mine, mT) ? [theirs, mine, mT] : [mine, theirs, tT];
  const ids = primary.trackIds.filter(id => !(bT.has(id) && !otherSet.has(id)));   // quitadas por el otro lado
  for (const id of other.trackIds) {
    if (bT.has(id) || ids.includes(id)) continue;                                 // añadidas por el otro lado
    const i = other.trackIds.indexOf(id);
    // al final si allí iba detrás de todo lo demás; si no, detrás de su vecina anterior
    if (other.trackIds.slice(i + 1).every(x => !ids.includes(x))) { ids.push(id); continue; }
    let at = 0;
    for (let k = i - 1; k >= 0; k--) { const j = ids.indexOf(other.trackIds[k]); if (j >= 0) { at = j + 1; break; } }
    ids.splice(at, 0, id);
  }
  const valid = new Set(sections.map(s => s.id)), trackSection = {}, added = { ...theirs.added };
  for (const id of ids) {
    const mineMoved = mT.has(id) && (mine.trackSection[id] || '') !== (base.trackSection[id] || '');
    const v = mineMoved || !tT.has(id) ? mine.trackSection[id] : theirs.trackSection[id];
    if (v && valid.has(v)) trackSection[id] = v;
    if (!(id in added) && mine.added[id]) added[id] = mine.added[id];
  }
  for (const id of Object.keys(added)) if (!ids.includes(id)) delete added[id];
  return { trackIds: ids, trackSection, added, sections };
}
