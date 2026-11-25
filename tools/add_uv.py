"""Add a UV atlas (TEXCOORD_0) to a rigged penguin GLB. One-off: python3 tools/add_uv.py in.glb out.glb
Box-projection charts (like Blender's Smart UV Project), packed in one square atlas.
Skeleton, weights and animations are carried over untouched."""
import json, struct, sys
import numpy as np
from collections import defaultdict, Counter

def load(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    bo = 20 + n
    bl = struct.unpack('<I', b[bo:bo + 4])[0]
    return j, bytearray(b[bo + 8:bo + 8 + bl])

def acc(j, bin_, i, dtype, ncomp):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(bytes(bin_[off:off + a['count'] * ncomp * np.dtype(dtype).itemsize]), dtype=dtype).reshape(a['count'], ncomp).copy()

def main(src, dst, pad=10 / 1024):
    j, bin_ = load(src)
    prim = j['meshes'][0]['primitives'][0]; A = prim['attributes']
    P = acc(j, bin_, A['POSITION'], np.float32, 3); N = acc(j, bin_, A['NORMAL'], np.float32, 3)
    J = acc(j, bin_, A['JOINTS_0'], np.uint8, 4); W = acc(j, bin_, A['WEIGHTS_0'], np.float32, 4)
    ia = j['accessors'][prim['indices']]
    F = acc(j, bin_, prim['indices'], np.uint16 if ia['componentType'] == 5123 else np.uint32, 1).reshape(-1, 3).astype(np.int64)
    # weld by position so adjacency survives any normal splits
    key = {}; weld = np.zeros(len(P), np.int64)
    for i, p in enumerate(np.round(P / 1e-6).astype(np.int64)):
        weld[i] = key.setdefault(tuple(p), len(key))
    FW = weld[F]
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    area = np.linalg.norm(fn, axis=1); fn = fn / np.maximum(area[:, None], 1e-20)
    AX = np.array([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]], np.float32)
    lab = np.argmax(fn @ AX.T, axis=1)
    edges = defaultdict(list)
    for f, t in enumerate(FW):
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            edges[(min(a, b), max(a, b))].append(f)
    nb = [[] for _ in F]
    for fs in edges.values():
        for a in fs:
            for b in fs:
                if a != b: nb[a].append(b)
    for _ in range(4):  # smooth labels
        new = lab.copy()
        for f in range(len(F)):
            c = Counter(lab[x] for x in nb[f]); c[lab[f]] += 1
            best = c.most_common(1)[0][0]
            if best != lab[f] and fn[f] @ AX[best] > 0.45: new[f] = best
        lab = new
    def components():
        comp = -np.ones(len(F), np.int64); k = 0
        for s in range(len(F)):
            if comp[s] >= 0: continue
            st = [s]; comp[s] = k
            while st:
                f = st.pop()
                for g in nb[f]:
                    if comp[g] < 0 and lab[g] == lab[f]: comp[g] = k; st.append(g)
            k += 1
        return comp, k
    for _ in range(6):  # dissolve tiny charts into their neighbours
        comp, k = components(); size = np.bincount(comp, minlength=k); changed = False
        for c in np.where(size < 24)[0]:
            fs = np.where(comp == c)[0]
            cnt = Counter(lab[g] for f in fs for g in nb[f] if comp[g] != c)
            for best, _n in cnt.most_common():
                if np.mean(fn[fs] @ AX[best]) > 0.05: lab[fs] = best; changed = True; break
        if not changed: break
    comp, k = components()
    # a chart must not land on itself when flattened (a flipper lying over the body): peel layers apart
    ext = float((P.max(0) - P.min(0)).max()); G = 160
    cen = P[F].mean(1)
    for c in range(k):
        fs = np.where(comp == c)[0]; ax = lab[fs[0]] // 2; uvax = [a for a in range(3) if a != ax]
        todo = set(fs.tolist()); first = True
        while todo:
            grid = {}; seed = next(iter(todo)); st = [seed]; got = set()
            while st:
                f = st.pop()
                if f not in todo or f in got: continue
                cell = (int(cen[f][uvax[0]] / ext * G), int(cen[f][uvax[1]] / ext * G)); d = cen[f][ax]
                if any(abs(grid.get((cell[0] + i, cell[1] + j), d) - d) > ext * 0.035 for i in (-1, 0, 1) for j in (-1, 0, 1)): continue
                grid.setdefault(cell, d); got.add(f)
                st.extend(g for g in nb[f] if g in todo and g not in got)
            todo -= got
            if not first:
                comp[list(got)] = k; k += 1
            first = False
    # peeling can leave crumbs: recompute connectivity inside every chart
    comp2 = -np.ones(len(F), np.int64); k2 = 0
    for s in range(len(F)):
        if comp2[s] >= 0: continue
        st = [s]; comp2[s] = k2
        while st:
            f = st.pop()
            for g in nb[f]:
                if comp2[g] < 0 and comp[g] == comp[f]: comp2[g] = k2; st.append(g)
        k2 += 1
    comp, k = comp2, k2
    # project each chart on its plane
    charts = []
    for c in range(k):
        fs = np.where(comp == c)[0]; ax = lab[fs[0]] // 2
        uvax = [a for a in range(3) if a != ax]
        vs = np.unique(F[fs])
        uv = P[vs][:, uvax].astype(np.float64)
        mn = uv.min(0); uv -= mn; wh = uv.max(0)
        charts.append(dict(fs=fs, vs=vs, uv=uv, w=wh[0], h=wh[1]))
    def layout(portrait):
        for c in charts:
            if (c['h'] > c['w']) != portrait and abs(c['h'] - c['w']) > 1e-12:
                c['uv'] = c['uv'][:, ::-1].copy(); c['w'], c['h'] = c['h'], c['w']
        charts.sort(key=lambda c: -c['h'])
        def pack(scale):
            x = y = 0.0; row = 0.0
            for c in charts:
                w, h = c['w'] * scale + pad, c['h'] * scale + pad
                if x + w > 1.0 and x > 0: x = 0.0; y += row; row = 0.0
                if w > 1.0: return None
                c['ox'], c['oy'] = x + pad / 2, y + pad / 2; x += w; row = max(row, h)
            return y + row
        lo, hi = 0.0, 1.0 / max(max(c['w'] for c in charts), 1e-9)
        for _ in range(40):
            mid = (lo + hi) / 2; h = pack(mid)
            if h is not None and h <= 1.0: lo = mid
            else: hi = mid
        pack(lo); return lo
    scale = max((layout(False), False), (layout(True), True))
    scale = layout(scale[1])
    # split vertices per chart
    nP, nN, nJ, nW, nUV = [], [], [], [], []; nF = np.zeros_like(F)
    base = 0
    for c in charts:
        remap = {v: base + i for i, v in enumerate(c['vs'])}
        nP.append(P[c['vs']]); nN.append(N[c['vs']]); nJ.append(J[c['vs']]); nW.append(W[c['vs']])
        uv = c['uv'] * scale + [c['ox'], c['oy']]
        nUV.append(uv)
        for f in c['fs']: nF[f] = [remap[v] for v in F[f]]
        base += len(c['vs'])
    nP, nN, nJ, nW = map(np.concatenate, (nP, nN, nJ, nW)); nUV = np.concatenate(nUV).astype(np.float32)
    assert len(nP) < 65535
    # fold / overlap report
    e1 = nUV[nF[:, 1]] - nUV[nF[:, 0]]; e2 = nUV[nF[:, 2]] - nUV[nF[:, 0]]
    a2 = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
    flips = 0
    for c in charts:
        s = np.sign(a2[c['fs']]); flips += int(min((s > 0).sum(), (s < 0).sum()))
    used = float(np.abs(a2).sum() / 2)
    # rebuild binary: new vertex data + untouched tail (inverse binds, animations)
    bvs = j['bufferViews']
    used_bv = sorted({j['accessors'][i]['bufferView'] for i in list(A.values()) + [prim['indices']]})
    tail_start = max(bvs[i]['byteOffset'] + bvs[i]['byteLength'] for i in used_bv)
    assert min(b.get('byteOffset', 0) for n_, b in enumerate(bvs) if n_ not in used_bv) >= tail_start
    out = bytearray()
    def put(arr, bv_index=None, target=34962):
        while len(out) % 4: out.append(0)
        off = len(out); data = arr.tobytes(); out.extend(data)
        view = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target}
        if bv_index is None: bvs.append(view); return len(bvs) - 1
        bvs[bv_index] = view; return bv_index
    def bvof(name): return j['accessors'][A[name]]['bufferView']
    put(nP.astype(np.float32), bvof('POSITION')); put(nN.astype(np.float32), bvof('NORMAL'))
    put(nJ.astype(np.uint8), bvof('JOINTS_0')); put(nW.astype(np.float32), bvof('WEIGHTS_0'))
    put(nF.astype(np.uint16).reshape(-1), j['accessors'][prim['indices']]['bufferView'], 34963)
    uvbv = put(nUV)
    while len(out) % 4: out.append(0)
    shift = len(out) - tail_start
    for n_, b in enumerate(bvs):
        if n_ not in used_bv and n_ != uvbv: b['byteOffset'] = b.get('byteOffset', 0) + shift
    out.extend(bin_[tail_start:])
    for name in ('POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'): j['accessors'][A[name]]['count'] = len(nP)
    pa = j['accessors'][A['POSITION']]; pa['min'] = nP.min(0).tolist(); pa['max'] = nP.max(0).tolist()
    j['accessors'][prim['indices']].update(count=int(nF.size), componentType=5123)
    j['accessors'].append({'bufferView': uvbv, 'componentType': 5126, 'count': len(nUV), 'type': 'VEC2'})
    A['TEXCOORD_0'] = len(j['accessors']) - 1
    j['buffers'][0]['byteLength'] = len(out)
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(out) % 4: out.append(0)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)
    print(f'{dst}: {len(charts)} charts, verts {len(P)}→{len(nP)}, atlas fill {used*100:.0f}%, folded tris {flips}/{len(F)}')
    return nUV, nF

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
