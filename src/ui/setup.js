// The setup screen: one table of the two sides, for single player, hosting and joining, and from the
// Esc menu mid-game. The host (or single player) sets how many planes a side has, and what its bots
// fly and how well; each player picks their own side and plane. It only draws what it's given and
// reports what's clicked: src/main.js holds the rules.
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false) e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

const select = (options, value, onchange, disabled = false) => {
  const s = el('select', { onchange: () => onchange(s.value), disabled: disabled && 'disabled' }, ...options.map(([v, label]) => el('option', { value: v }, label)));
  s.value = value;
  return s;
};

// planes: [[id, name]...]; levels: [[id, name]...]. on: { planes(n), skill(team, id), botPlane(team, id),
// side(team), plane(id), start(), back() }.
export function createSetup({ parent, planes, levels, on }) {
  const code = el('div', { class: 'setup-code hidden' });
  const table = el('div', { class: 'setup-table' });
  const status = el('p', { class: 'status' });
  const startBtn = el('button', { class: 'go', onclick: () => on.start() });
  const backBtn = el('button', { class: 'back', onclick: () => on.back() }, 'BACK');
  const screen = el('div', { id: 'setup', class: 'screen hidden' }, el('h2', {}, 'THE SIDES'), code, table, status, startBtn, backBtn);
  parent.append(screen);
  // Menu keys and typing here mustn't fly the plane.
  screen.addEventListener('keydown', (e) => e.code !== 'Escape' && e.stopPropagation());

  const say = (text, bad = false) => {
    status.textContent = text;
    status.classList.toggle('bad', bad);
  };

  // state: { code, canEdit, planes (per side), sides: [{ team, label, skill, botPlane, bots,
  // players: [{ id, name, plane, me }] }], myPlane, start: label, canStart, canSwitch }
  function draw(state) {
    code.classList.toggle('hidden', !state.code);
    code.textContent = state.code ? `ROOM CODE  ${state.code}` : '';
    const head = el('div', { class: 'setup-row head' }, el('span'), ...state.sides.map((s) => el('span', {}, s.label)));
    const rows = [head];
    const cells = (label, make) => el('div', { class: 'setup-row' }, el('span', { class: 'label' }, label), ...state.sides.map(make));
    rows.push(cells('PILOTS', (s) => el('div', { class: 'pilots' },
      ...s.players.map((p) => el('div', { class: p.me ? 'pilot me' : 'pilot' }, `${p.name} - ${p.plane}`)),
      ...Array.from({ length: s.bots }, () => el('div', { class: 'pilot bot' }, 'BOT')),
    )));
    rows.push(cells('', (s) => {
      if (s.players.some((p) => p.me)) return el('div', { class: 'here' }, 'YOUR SIDE');
      return el('button', { class: 'join-side', disabled: !state.canSwitch && 'disabled', onclick: () => on.side(s.team) }, 'FLY FOR THIS SIDE');
    }));
    rows.push(cells('BOT SKILL', (s) => select(levels, s.skill, (v) => on.skill(s.team, v), !state.canEdit)));
    rows.push(cells('BOTS FLY', (s) => select(planes, s.botPlane, (v) => on.botPlane(s.team, v), !state.canEdit)));
    const perSide = el('div', { class: 'setup-row wide' },
      el('span', { class: 'label' }, 'PLANES PER SIDE'),
      select([[1, '1'], [2, '2']], state.planes, (v) => on.planes(Number(v)), !state.canEdit),
      el('span', { class: 'label' }, 'YOUR PLANE'),
      select(planes, state.myPlane, (v) => on.plane(v)),
    );
    table.replaceChildren(...rows, perSide);
    startBtn.textContent = state.start;
    startBtn.disabled = !state.canStart;
  }

  return {
    get isOpen() {
      return !screen.classList.contains('hidden');
    },
    show: () => screen.classList.remove('hidden'),
    hide: () => screen.classList.add('hidden'),
    draw,
    say,
  };
}
