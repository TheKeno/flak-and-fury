// The on-screen line for a 'shotDown' event as the player sees it (null: nothing to say). Kept apart from
// main.js so a headless test can check it. A plane the player brought down is only an "enemy" if it
// flew for the other side: ramming a friend must not read as a kill.
export function shotDownMessage(world, e, player) {
  if (e.by === player.id && e.plane !== player.id) {
    const victim = world.planes.find((p) => p.id === e.plane);
    if (victim && victim.team === player.team) {
      return { text: victim.callsign ? `YOU DOWNED A FRIEND: ${victim.callsign.toUpperCase()}` : 'YOU DOWNED A FRIEND', color: '#ff8070' };
    }
    return { text: 'ENEMY SHOT DOWN!', color: '#e8c860' };
  }
  if (e.plane === player.id) return { text: 'YOU ARE GOING DOWN', color: '#ff8070' };
  return null;
}
