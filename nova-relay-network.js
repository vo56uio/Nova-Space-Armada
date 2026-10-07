/* Nova Relay Network — topology prototype
 * v0.1: discovery, capability scoring, deterministic root/relay election,
 * primary/backup topology and load distribution.
 * IMPORTANT: this prototype does NOT relay audio yet and does NOT replace
 * the current WebRTC voice mesh. It is intentionally isolated.
 */
(() => {
  'use strict';

  const VERSION = '0.1.0';
  const HEARTBEAT_MAX_AGE_MS = 30_000;
  const MIN_RELAY_SCORE = 58;
  const ROOT_COUNT = 2;
  const STANDBY_COUNT = 1;
  const MAX_HOPS = 2;

  let state = null;
  let renderTimer = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function localNetworkInfo() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    return {
      online: navigator.onLine !== false,
      rtt: clamp(num(c?.rtt, 0), 0, 2000),
      downlink: clamp(num(c?.downlink, 0), 0, 1000),
      effectiveType: c?.effectiveType || 'unknown'
    };
  }

  function calculateLocalCapability() {
    const cores = Math.max(1, num(navigator.hardwareConcurrency, 4));
    const memory = Math.max(0, num(navigator.deviceMemory, 0));
    const net = localNetworkInfo();

    let score = 50;
    score += clamp((cores - 2) * 5, -5, 20);
    if (memory >= 16) score += 15;
    else if (memory >= 8) score += 10;
    else if (memory >= 4) score += 5;

    if (net.downlink >= 20) score += 10;
    else if (net.downlink >= 10) score += 6;
    else if (net.downlink >= 5) score += 3;

    if (net.rtt > 0 && net.rtt <= 50) score += 8;
    else if (net.rtt > 0 && net.rtt <= 90) score += 5;
    else if (net.rtt > 180) score -= 8;

    if (net.effectiveType === '4g') score += 3;
    if (net.effectiveType === '3g' || net.effectiveType === '2g') score -= 10;
    if (!net.online) score = 0;

    score = clamp(Math.round(score), 0, 100);

    const maxChildren = score >= 90 ? 5
      : score >= 80 ? 4
      : score >= 70 ? 3
      : score >= MIN_RELAY_SCORE ? 2
      : 0;

    return {
      version: VERSION,
      capable: !!(net.online && window.RTCPeerConnection && maxChildren > 0),
      score,
      maxChildren,
      cores,
      memoryGb: memory || null,
      network: net,
      updatedAt: Date.now()
    };
  }

  function stableNodeKey(node) {
    return String(node.uid || '');
  }

  function nodeScore(node) {
    const relay = node?.relay || {};
    let score = num(relay.score, 0);

    const age = Date.now() - num(node?.lastSeen, 0);
    if (age > HEARTBEAT_MAX_AGE_MS) score = 0;
    if (relay.capable === false) score = 0;

    // Mild preference for nodes with existing relay capacity.
    const capacity = Math.max(0, num(relay.maxChildren, 0));
    score += Math.min(8, capacity * 1.5);

    return clamp(score, 0, 108);
  }

  function sortCandidates(nodes) {
    return nodes.slice().sort((a, b) => {
      const scoreDiff = nodeScore(b) - nodeScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return stableNodeKey(a).localeCompare(stableNodeKey(b));
    });
  }

  function fallbackRemoteCapability(uid, online = true) {
    const text = String(uid || 'node');
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    const normalized = Math.abs(hash) % 36;
    const score = online ? 58 + normalized : 0;
    return {
      version: VERSION,
      capable: !!online,
      score,
      maxChildren: online ? (score >= 88 ? 5 : score >= 76 ? 4 : score >= 66 ? 3 : 2) : 0,
      cores: null,
      memoryGb: null,
      network: { rtt: null, downlink: null, effectiveType: 'remote-estimate' },
      updatedAt: Date.now(),
      estimated: true
    };
  }

  function normalizedParticipants(participants, selfId) {
    const now = Date.now();
    const list = Array.isArray(participants) ? participants : [];

    const unique = new Map();
    for (const raw of list) {
      if (!raw?.uid) continue;
      const p = { ...raw };
      const online = p.status !== 'offline';
      p.relay = p.relay && typeof p.relay === 'object' ? p.relay : fallbackRemoteCapability(p.uid, online);
      p.lastSeen = num(p.lastSeen, now);
      if (now - p.lastSeen >= HEARTBEAT_MAX_AGE_MS) continue;
      unique.set(String(p.uid), p);
    }

    if (selfId && !unique.has(String(selfId))) {
      unique.set(String(selfId), {
        uid: String(selfId),
        nickname: 'Вы',
        lastSeen: now,
        relay: calculateLocalCapability()
      });
    }

    return Array.from(unique.values());
  }

  function chooseRelays(participants) {
    const eligible = sortCandidates(participants).filter(p =>
      p.relay?.capable !== false &&
      nodeScore(p) >= MIN_RELAY_SCORE &&
      num(p.relay?.maxChildren, 0) > 0
    );

    const roots = eligible.slice(0, Math.min(ROOT_COUNT, eligible.length));
    const rootIds = new Set(roots.map(p => p.uid));

    // Keep the next strongest node warm but inactive.
    const standby = eligible.filter(p => !rootIds.has(p.uid)).slice(0, STANDBY_COUNT);

    // More users -> more active relay workers. Small rooms keep the topology small.
    const nonRoots = eligible.filter(p => !rootIds.has(p.uid) && !standby.some(s => s.uid === p.uid));
    const targetWorkers = participants.length >= 12 ? 6
      : participants.length >= 8 ? 4
      : participants.length >= 5 ? 3
      : 0;

    const workers = nonRoots.slice(0, Math.min(targetWorkers, nonRoots.length));

    // In tiny rooms a second root itself is enough; don't force relay workers.
    return { roots, workers, standby };
  }

  function buildTopology(participants, selfId) {
    const { roots, workers, standby } = chooseRelays(participants);

    // No need to build a relay network for a tiny room.
    if (participants.length <= 2 || roots.length === 0) {
      return {
        version: VERSION,
        mode: 'direct',
        roots,
        workers: [],
        standby,
        links: [],
        routes: [],
        generatedAt: Date.now()
      };
    }

    const activeRelays = [...roots, ...workers];
    const relayIds = new Set(activeRelays.map(x => x.uid));
    const load = new Map(activeRelays.map(x => [x.uid, 0]));
    const links = [];
    const routes = [];

    if (roots.length === 2) {
      links.push({ from: roots[0].uid, to: roots[1].uid, kind: 'backbone', hops: 1 });
    }

    function capacity(node) {
      return Math.max(1, num(node?.relay?.maxChildren, 1));
    }

    function choosePrimaryFor(user) {
      const candidates = activeRelays
        .filter(relay => relay.uid !== user.uid)
        .map(relay => ({
          relay,
          used: load.get(relay.uid) || 0,
          capacity: capacity(relay),
          ratio: (load.get(relay.uid) || 0) / capacity(relay)
        }))
        .filter(x => x.used < x.capacity)
        .sort((a, b) => {
          if (a.ratio !== b.ratio) return a.ratio - b.ratio;
          const s = nodeScore(b.relay) - nodeScore(a.relay);
          if (s !== 0) return s;
          return stableNodeKey(a.relay).localeCompare(stableNodeKey(b.relay));
        });
      return candidates[0]?.relay || null;
    }

    const users = participants
      .filter(p => !relayIds.has(p.uid))
      .sort((a, b) => {
        const scoreDiff = nodeScore(b) - nodeScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        return stableNodeKey(a).localeCompare(stableNodeKey(b));
      });

    for (const user of users) {
      const primary = choosePrimaryFor(user);
      if (!primary) continue;

      load.set(primary.uid, (load.get(primary.uid) || 0) + 1);

      const backupCandidates = activeRelays
        .filter(r => r.uid !== primary.uid && r.uid !== user.uid)
        .sort((a, b) => {
          const aRoot = roots.some(x => x.uid === a.uid) ? 1 : 0;
          const bRoot = roots.some(x => x.uid === b.uid) ? 1 : 0;
          if (aRoot !== bRoot) return bRoot - aRoot;
          const s = nodeScore(b) - nodeScore(a);
          if (s !== 0) return s;
          return stableNodeKey(a).localeCompare(stableNodeKey(b));
        });

      const backup = backupCandidates[0] || null;

      routes.push({
        uid: user.uid,
        primary: primary.uid,
        backup: backup?.uid || null,
        hops: MAX_HOPS <= 2 ? 1 : 2
      });

      links.push({
        from: user.uid,
        to: primary.uid,
        kind: 'primary',
        hops: 1
      });

      if (backup) {
        links.push({
          from: user.uid,
          to: backup.uid,
          kind: 'backup',
          hops: 1
        });
      }
    }

    // Relay workers are also attached to a root so the network stays bounded.
    for (const worker of workers) {
      const rootCandidates = roots.filter(r => r.uid !== worker.uid);
      if (!rootCandidates.length) continue;
      const root = rootCandidates
        .slice()
        .sort((a, b) => {
          const ar = (load.get(a.uid) || 0) / capacity(a);
          const br = (load.get(b.uid) || 0) / capacity(b);
          if (ar !== br) return ar - br;
          return stableNodeKey(a).localeCompare(stableNodeKey(b));
        })[0];

      load.set(root.uid, (load.get(root.uid) || 0) + 1);
      links.push({ from: worker.uid, to: root.uid, kind: 'relay-parent', hops: 1 });
    }

    const loadReport = activeRelays.map(node => ({
      uid: node.uid,
      nickname: node.nickname || 'Пользователь',
      role: roots.some(r => r.uid === node.uid) ? 'ROOT' : 'RELAY',
      score: Math.round(nodeScore(node)),
      used: load.get(node.uid) || 0,
      capacity: capacity(node),
      utilization: Math.round(((load.get(node.uid) || 0) / capacity(node)) * 100)
    }));

    return {
      version: VERSION,
      mode: 'relay',
      roots,
      workers,
      standby,
      links,
      routes,
      loadReport,
      generatedAt: Date.now(),
      selfId
    };
  }

  function roleFor(uid, topology) {
    if (!topology) return 'USER';
    if (topology.roots.some(x => x.uid === uid)) return 'ROOT';
    if (topology.workers.some(x => x.uid === uid)) return 'RELAY';
    if (topology.standby.some(x => x.uid === uid)) return 'STANDBY';
    return 'USER';
  }

  function shortList(items) {
    return items.map(x => x.nickname || x.uid).join(', ') || '—';
  }

  function render() {
    if (!state) return;
    const box = document.getElementById('nova-relay-prototype');
    const details = document.getElementById('nova-relay-prototype-details');
    if (!box || !details) return;

    const t = state.topology;
    box.classList.remove('hidden');

    const rootNames = t.roots.length ? shortList(t.roots) : 'нет';
    const workers = t.workers.length;
    const standby = t.standby.length;
    const role = roleFor(state.selfId, t);
    const selfInfo = state.participants.find(p => p.uid === state.selfId);

    const overloaded = (t.loadReport || []).filter(x => x.utilization >= 85).length;
    const headroom = (t.loadReport || []).reduce((sum, x) => sum + Math.max(0, x.capacity - x.used), 0);

    const modeText = t.mode === 'direct' ? 'прямое соединение' : 'распределённая сеть';
    const line = document.getElementById('nova-relay-prototype-line');
    if (line) {
      line.textContent = 'Relay prototype: ' + modeText + ' · ROOT ' + t.roots.length + ' · RELAY ' + workers + ' · STANDBY ' + standby + ' · вы: ' + role;
    }

    details.textContent =
      'Корни: ' + rootNames +
      ' · узлов: ' + state.participants.length +
      ' · запасных слотов: ' + headroom +
      (overloaded ? ' · перегружено: ' + overloaded : '') +
      '\nМаршруты: ' + t.routes.length + ' · резервов: ' + t.routes.filter(r => r.backup).length +
      (selfInfo?.relay?.estimated ? '\nДоступность удалённых relay пока моделируется.' : '');

    const tree = document.getElementById('nova-relay-prototype-tree');
    if (tree) {
      if (t.mode === 'direct') {
        tree.textContent = 'Комната маленькая: relay-сеть не нужна, остаёмся на прямом WebRTC.';
      } else {
        const rows = [];
        for (const root of t.roots) {
          const children = (t.links || []).filter(l => l.to === root.uid && (l.kind === 'primary' || l.kind === 'relay-parent')).map(l => l.from);
          const relayName = root.nickname || root.uid;
          rows.push(relayName + ' [ROOT] ← ' + (children.length ? children.join(', ') : 'нет веток'));
        }
        if (t.roots.length === 2) rows.unshift(t.roots[0].nickname + ' ⇄ ' + t.roots[1].nickname + ' [BACKBONE]');
        tree.textContent = rows.join('\\n') || 'Топология пока не построена.';
      }
    }
  }

  function update(participants) {
    if (!state) return;
    const normalized = normalizedParticipants(participants, state.selfId);
    state.participants = normalized;
    state.localRelay = calculateLocalCapability();
    // Keep our published self capability visible even before the next heartbeat.
    const self = state.participants.find(p => p.uid === state.selfId);
    if (self) self.relay = state.localRelay;
    state.topology = buildTopology(normalized, state.selfId);
    render();
  }

  function start({ selfId, participants = [], getParticipants = null } = {}) {
    if (!selfId) return;
    state = {
      selfId: String(selfId),
      roomId: null,
      participants: [],
      localRelay: calculateLocalCapability(),
      topology: null,
      startedAt: Date.now(),
      getParticipants: typeof getParticipants === 'function' ? getParticipants : null
    };
    update(participants);
    clearTimeout(renderTimer);
    renderTimer = setInterval(() => {
      const latest = state?.getParticipants?.();
      update(Array.isArray(latest) ? latest : state?.participants || []);
    }, 5000);
  }

  function stop() {
    clearInterval(renderTimer);
    renderTimer = null;
    state = null;
    const box = document.getElementById('nova-relay-prototype');
    box?.classList.add('hidden');
    const line = document.getElementById('nova-relay-prototype-line');
    if (line) line.textContent = 'Relay prototype: ожидание…';
    const details = document.getElementById('nova-relay-prototype-details');
    if (details) details.textContent = 'Топология пока не построена.';
    const tree = document.getElementById('nova-relay-prototype-tree');
    if (tree) tree.textContent = 'Топология пока не построена.';
  }

  function getPresencePayload() {
    return calculateLocalCapability();
  }

  function getSnapshot() {
    if (!state) return null;
    return JSON.parse(JSON.stringify(state));
  }

  window.NovaRelayNetwork = {
    version: VERSION,
    start,
    update,
    stop,
    getPresencePayload,
    getSnapshot
  };
})();
