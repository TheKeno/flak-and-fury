// How data/outlines/*.json is written: two-space indent, every row of numbers on one line, so a
// station table reads like the table it is and git diffs stay small. Shared by the Outline Lab (browser)
// and the migration tools.
const ORDER = ['plane', 'template', 'sprite', '_notes', 'length', 'span', 'scale', 'frame', 'fuselage', 'spinner', 'spine', 'nacelle', 'gunTray', 'radiators', 'bump', 'bump2', 'bump3', 'spat', 'canopy', 'wing', 'tailplane', 'fin', 'fins', 'points', 'gear', 'touchups'];

export function formatOutline(o) {
  const ordered = {};
  for (const k of ORDER) if (o[k] !== undefined) ordered[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in ordered)) ordered[k] = o[k];
  // Each crew/gun dot on one line, like a station row.
  const pts = ordered.points;
  if (pts) ordered.points = pts.map((_, i) => `@@pt${i}@@`);
  let json = JSON.stringify(ordered, null, 2);
  if (pts) pts.forEach((p, i) => { json = json.replace(`"@@pt${i}@@"`, () => JSON.stringify(p).replace(/,(?=[-\d"])/g, ', ').replace(/":/g, '": ')); });
  return json.replace(/\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g, (_, inner) => `[${inner.replace(/,\s+/g, ', ')}]`) + '\n';
}
