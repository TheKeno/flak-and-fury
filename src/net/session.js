// Online play over WebRTC, through PeerJS. The host's browser runs the real world; guests send the
// commands their keys make, tick by tick, and get snapshots back (src/net/snapshot.js). PeerJS's free
// public broker only introduces the two browsers; the game itself flows directly between them, so no
// server of our own is needed (the game runs from GitHub Pages).
import { encodeEvent, encodeWorld, diff, staticRefs } from './snapshot.js';
import { NO_COMMAND } from '../sim/plane.js';

const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'flak-and-fury-';
// No I, L, O or 0: room codes get read out over voice chat.
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;
// A guest's commands queue up on the host when the connection hiccups; past this the oldest go, so
// the guest's plane never lags far behind their keys.
const MAX_QUEUE = 8;
const KEEP_QUEUE = 3;

let peerJs = null;
// PeerJS is only fetched when someone goes online, so single player works offline.
function loadPeerJs() {
  peerJs ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEERJS;
    s.onload = () => resolve(window.Peer);
    s.onerror = () => {
      peerJs = null;
      reject(new Error('could not load PeerJS (offline?)'));
    };
    document.head.append(s);
  });
  return peerJs;
}

const randomCode = () => Array.from({ length: CODE_LENGTH }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
export const cleanCode = (text) => text.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);

// Resolves with an open Peer, or rejects with PeerJS's error (err.type says why).
function openPeer(Peer, id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id) : new Peer();
    peer.once('open', () => resolve(peer));
    peer.once('error', (err) => {
      peer.destroy();
      reject(err);
    });
  });
}

// Hosts a game. onJoin(guest, hello) adds the guest's plane and returns what to tell them
// ({ planeId }); onLeave(guest) removes it. cfg: the net settings (snapshotEvery), read live.
export async function hostGame(world, cfg, { onJoin, onLeave }) {
  const Peer = await loadPeerJs();
  let peer;
  let code;
  for (let tries = 0; !peer; tries++) {
    code = randomCode();
    try {
      peer = await openPeer(Peer, PREFIX + code);
    } catch (err) {
      // Someone else has that code: draw another.
      if (err.type !== 'unavailable-id' || tries > 5) throw err;
    }
  }
  const refs = staticRefs(world);
  const guests = new Set();
  let nextGuest = 1;
  let pending = []; // [tick, event] since the last snapshot

  peer.on('connection', (conn) => {
    let guest = null;
    conn.on('data', (m) => {
      if (m?.t === 'hello' && !guest) {
        guest = { conn, controller: `net${nextGuest++}`, queue: [], last: NO_COMMAND, base: {}, name: m.name };
        guests.add(guest);
        conn.send({ t: 'welcome', ...onJoin(guest, m) });
      } else if (m?.t === 'cmd' && guest && Array.isArray(m.c)) {
        guest.queue.push(...m.c);
        if (guest.queue.length > MAX_QUEUE) guest.queue.splice(0, guest.queue.length - KEEP_QUEUE);
      }
    });
    // Either end gone or broken: drop the guest and close, so the guest hears about it too.
    const leave = () => {
      conn.close();
      if (!guest || !guests.delete(guest)) return;
      onLeave(guest);
    };
    conn.on('close', leave);
    conn.on('error', leave);
  });
  // The broker connection only matters for new guests; reconnect quietly if it drops.
  peer.on('disconnected', () => !peer.destroyed && peer.reconnect());

  return {
    code,
    guests,
    // One command per guest for this tick: the next one they sent, or (when none has arrived yet)
    // their last, so held keys stay held through a hiccup.
    commands() {
      const out = {};
      for (const g of guests) {
        if (g.queue.length) g.last = g.queue.shift();
        out[g.controller] = g.last;
      }
      return out;
    },
    // Called after every tick: keeps the tick's events and sends a snapshot every few ticks.
    afterTick() {
      if (!guests.size) {
        pending = [];
        return;
      }
      for (const e of world.events) pending.push([world.tick, encodeEvent(e, refs)]);
      if (world.tick % Math.max(1, cfg.snapshotEvery ?? 3)) return;
      const tree = encodeWorld(world, refs);
      for (const g of guests) {
        if (!g.conn.open) continue;
        const p = diff(g.base, tree);
        g.base = tree;
        g.conn.send({ t: 'snap', tick: world.tick, p: p ?? null, ev: pending });
      }
      pending = [];
    },
    close: () => peer.destroy(),
  };
}

// Joins the game with the given room code. hello: what to tell the host (plane). onMessage gets the
// host's welcome and snapshots; onClose fires when the connection ends.
export async function joinGame(code, hello, { onMessage, onClose }) {
  const Peer = await loadPeerJs();
  const peer = await openPeer(Peer);
  const conn = await new Promise((resolve, reject) => {
    // Binary (PeerJS's default) splits big messages into pieces; its JSON channel refuses anything
    // over 16 KB, and the first snapshot (the whole world) is about 50.
    const c = peer.connect(PREFIX + cleanCode(code), { reliable: true, serialization: 'binary' });
    const fail = (err) => {
      peer.destroy();
      reject(err);
    };
    peer.once('error', fail);
    c.once('open', () => {
      peer.off('error', fail);
      resolve(c);
    });
  });
  conn.send({ t: 'hello', ...hello });
  conn.on('data', onMessage);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    onClose();
  };
  conn.on('close', close);
  conn.on('error', close);
  peer.on('error', close);
  return {
    sendCommands: (c) => conn.open && c.length && conn.send({ t: 'cmd', c }),
    close: () => peer.destroy(),
  };
}
