/* Graph domain slice — nodes, edges, taxonomy, camera, selection, focus.
   Mutable plain object by design (the render pipeline reads it every frame). */

export const graph = {
    // Default platí len do prvej odpovede /api/mind (`S.name = data.name` v
    // graph/loader.js). Aj tak musí byť správny: feeduje aria popis plátna
    // v graph/input.js, ktorý screen reader prečíta ešte pred načítaním dát.
    name: 'AuraAI',
    nodes: [],
    edges: [],
    areas: new Map(),
    departments: new Map(),
    byId: new Map(),
    sim: null,
    cam: { x: 0, y: 0, k: 0.85 },
    dpr: 1, w: 0, h: 0,
    pulses: [],
    hover: null,
    selected: null,
    focus: { areaId: null, departmentId: null },
    _hlFor: null,
    _hlSet: null,
    local: null,          // { rootId, depth } — lokálny graf (Obsidian local graph)
    _localFor: null,
    _localSet: null,
    degree: new Map(),    // nodeId → počet hrán, prepočet v buildSim
    connectFrom: null,    // id zdrojového uzla pri ručnom prepájaní (connect mode)
    awakeUntil: 0,
    awakeMinutes: 5,
    dim: 1,
    activations: [],
    replay: { on: false, t: 1, playing: false, tMin: 0, tMax: 0 },
    _layerCache: null,    // poradie stĺpcov pre náhľad Vrstvy
    _lpFor: null,         // memoizácia layerPathSet
    _lpNodes: null,
    _lpEdges: null,
};
