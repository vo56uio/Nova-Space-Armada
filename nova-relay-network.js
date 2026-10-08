// Nova Relay Network v0.2.1 — live topology engine.
// Plans roots, relay roles and bounded routes. Media forwarding remains v0.2.2.
export class NovaRelayNetwork {
  static MAX_RELAY_CHILDREN = 6;
  static MAX_HOPS = 2;
  static HEADROOM = 0.75;
  static ROOT_RECOVERY_MS = 10000;

  constructor({selfId, getParticipants, onPlanChange}={}) {
    this.selfId = selfId || null;
    this.getParticipants = typeof getParticipants === 'function' ? getParticipants : () => [];
    this.onPlanChange = typeof onPlanChange === 'function' ? onPlanChange : null;
    this.running = false;
    this.lastPlan = null;
    this.failedRoots = new Map();
  }

  static getLocalCapability() {
    const cores = Number(navigator.hardwareConcurrency || 4);
    const memory = Number(navigator.deviceMemory || 4);
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const downlink = Number(c?.downlink || 0);
    const rtt = Number(c?.rtt || 0);
    const saveData = !!c?.saveData;
    let score = 35 + Math.min(25, Math.max(0, (cores - 2) * 5))
      + Math.min(20, Math.max(0, (memory - 2) * 5))
      + Math.min(15, downlink * 1.5);
    if (rtt > 0) score -= Math.min(15, rtt / 30);
    if (saveData) score -= 15;
    return {
      score: Math.max(1, Math.round(score)),
      cores, memory, downlink, rtt, saveData,
      capacity: Math.max(2, Math.min(6, Math.floor(Math.max(1, score) / 18)))
    };
  }

  getPresencePayload() { return NovaRelayNetwork.getLocalCapability(); }

  start() {
    this.running = true;
    return this.update(this.getParticipants());
  }

  stop() {
    this.running = false;
    this.lastPlan = null;
  }

  update(participants=[]) {
    if (!this.running) return null;
    const now = Date.now();
    const active = participants
      .filter(p => p?.uid && (now - Number(p.lastSeen || now) < 30000) && p.status !== 'offline')
      .map(p => ({...p, uid:String(p.uid)}));
    const plan = this.buildPlan(active);
    this.lastPlan = plan;
    try { this.onPlanChange?.(plan); }
    catch (e) { console.warn('[NovaRelayNetwork] callback failed:', e); }
    return plan;
  }

  capability(p) {
    const c = p.relayCapability;
    if (c && Number.isFinite(Number(c.score))) {
      return {
        score: Number(c.score),
        capacity: Math.max(2, Math.min(6, Number(c.capacity) || 2))
      };
    }
    let hash = 2166136261;
    for (const ch of String(p.uid)) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return {score:40 + ((hash >>> 0) % 51), capacity:6};
  }

  buildPlan(active) {
    const ranked = [...active].sort((a,b) => {
      const ca=this.capability(a), cb=this.capability(b);
      return cb.score-ca.score || Number(a.joinedAt||0)-Number(b.joinedAt||0) || a.uid.localeCompare(b.uid);
    });
    const roots=[];
    for (const p of ranked) {
      if ((this.failedRoots.get(p.uid)||0) > Date.now()) continue;
      roots.push(p);
      if (roots.length===2) break;
    }

    const rootIds=new Set(roots.map(p=>p.uid));
    const candidates=active.filter(p=>!rootIds.has(p.uid));
    const relayCount=Math.ceil(active.length/(NovaRelayNetwork.MAX_RELAY_CHILDREN*NovaRelayNetwork.HEADROOM));
    const relays=[...candidates]
      .sort((a,b)=>this.capability(b).score-this.capability(a).score)
      .slice(0,Math.min(relayCount,candidates.length));
    const relayIds=new Set(relays.map(p=>p.uid));
    const leaves=candidates.filter(p=>!relayIds.has(p.uid));
    const nodes=new Map();

    for (const r of roots) nodes.set(r.uid,{uid:r.uid,role:'root',parent:null,children:[],capacity:24});
    for (const r of relays) nodes.set(r.uid,{uid:r.uid,role:'relay',parent:null,children:[],capacity:this.capability(r).capacity});
    for (const u of leaves) nodes.set(u.uid,{uid:u.uid,role:'leaf',parent:null,children:[],capacity:0});

    for (const r of relays) {
      const choices=roots
        .filter(root=>nodes.get(root.uid).children.length<24)
        .sort((a,b)=>nodes.get(a.uid).children.length-nodes.get(b.uid).children.length);
      const parent=choices[0];
      if (parent) {
        nodes.get(r.uid).parent=parent.uid;
        nodes.get(parent.uid).children.push(r.uid);
      }
    }

    const freeByRoot=root=>relays
      .filter(r=>nodes.get(r.uid).parent===root.uid)
      .reduce((sum,r)=>sum+Math.max(0,nodes.get(r.uid).capacity-nodes.get(r.uid).children.length),0);
    const routes={};

    for (const u of leaves) {
      const selected=roots
        .map(root=>({root,free:freeByRoot(root)}))
        .sort((a,b)=>b.free-a.free)[0]?.root;
      if (!selected) {
        routes[u.uid]={state:'unreachable'};
        continue;
      }
      const relay=relays
        .filter(r=>nodes.get(r.uid).parent===selected.uid)
        .filter(r=>nodes.get(r.uid).children.length<nodes.get(r.uid).capacity)
        .sort((a,b)=>
          (nodes.get(b.uid).capacity-nodes.get(b.uid).children.length) -
          (nodes.get(a.uid).capacity-nodes.get(a.uid).children.length)
        )[0];
      if (!relay) {
        routes[u.uid]={state:'unreachable'};
        continue;
      }
      nodes.get(relay.uid).children.push(u.uid);
      nodes.get(u.uid).parent=relay.uid;
      routes[u.uid]={
        state:'ready',
        root:selected.uid,
        relay:relay.uid,
        hops:2,
        backupRoot:roots.find(r=>r.uid!==selected.uid)?.uid||null
      };
    }

    const self=active.find(p=>p.uid===this.selfId);
    const role=self ? (rootIds.has(self.uid)?'root':relayIds.has(self.uid)?'relay':'leaf') : 'offline';
    return {
      version:'0.2.1',
      generatedAt:Date.now(),
      participantCount:active.length,
      roots:roots.map(r=>r.uid),
      rootA:roots[0]?.uid||null,
      rootB:roots[1]?.uid||null,
      relayCount:relays.length,
      nodes:[...nodes.values()],
      routes,
      unreachable:active.filter(p=>routes[p.uid]?.state==='unreachable').map(p=>p.uid),
      maxHops:NovaRelayNetwork.MAX_HOPS,
      headroom:NovaRelayNetwork.HEADROOM,
      role,
      selfRoute:self ? (routes[self.uid]||{state:'ready',root:self.uid,hops:0}) : null
    };
  }

  markRootFailed(uid) {
    if (!uid) return null;
    this.failedRoots.set(String(uid),Date.now()+NovaRelayNetwork.ROOT_RECOVERY_MS);
    return this.update(this.getParticipants());
  }

  getSnapshot() { return this.lastPlan; }
}

export default NovaRelayNetwork;
