// client/glb.js — a minimal GLB loader for THIS game's weapon assets, not a
// general glTF importer. The three provided gun models are simple embedded
// GLBs: one mesh, a few unlit-texture-free PBR materials, node TRS transforms
// (the FBX2glTF ×100 scale), POSITION/NORMAL float32 accessors and uint16
// indices. Rather than vendoring three.js's ~3000-line GLTFLoader + deps, we
// parse exactly that subset (~140 lines) and no more. If a future asset needs
// skins/animations/textures, THIS is the module to replace.
//
// Verified against: Assault Rifle-Bgvuu4CUMV.glb, Submachine Gun.glb,
// Sniper Rifle-TKaBjAEofL.glb (all FBX2glTF v0.9.7).

import * as THREE from 'three'

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

function decodeAccessor(json, buffer, binOff, index) {
  const acc = json.accessors[index]
  const bv = json.bufferViews[acc.bufferView]
  const offset = binOff + (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const n = acc.count * COMPONENTS[acc.type]
  if (acc.componentType === 5126) return new Float32Array(buffer, offset, n)
  if (acc.componentType === 5123) return new Uint16Array(buffer, offset, n)
  if (acc.componentType === 5125) return new Uint32Array(buffer, offset, n)
  throw new Error('[glb] unsupported componentType ' + acc.componentType)
}

// node TRS/matrix -> column-major Float64Array (same math sim/path.js uses;
// glTF node matrices are column-major already)
function nodeMatrix(n) {
  if (n.matrix) return Float64Array.from(n.matrix)
  const t = n.translation || [0, 0, 0]
  const q = n.rotation || [0, 0, 0, 1]
  const s = n.scale || [1, 1, 1]
  const [x, y, z, w] = q
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  return Float64Array.from([
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ])
}

function mul(a, b) {
  const o = new Float64Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  }
  return o
}

// parse(arrayBuffer) -> THREE.Group. Throws on anything outside the subset.
export function parseGLB(buffer) {
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('[glb] not a GLB')
  const jsonLen = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)))
  const binStart = 20 + jsonLen + 8
  const binByteLen = view.getUint32(20 + jsonLen, true)
  // absolute byte offset of the BIN chunk, bumped to 4-byte alignment
  // (accessors are 4-byte aligned by the glTF spec; FBX2glTF sometimes pads)
  const binOff = binStart + ((4 - (binStart % 4)) % 4)
  if (binOff + binByteLen > buffer.byteLength) throw new Error('[glb] BIN chunk overruns file')

  const root = new THREE.Group()
  root.name = json.scenes?.[0]?.name || 'glb'

  const mats = (json.materials || []).map((m) => {
    const pbr = m.pbrMetallicRoughness || {}
    const col = new THREE.Color()
    const f = pbr.baseColorFactor || [1, 1, 1, 1]
    col.setRGB(f[0], f[1], f[2]) // linear working space — matches GLTFLoader
    return new THREE.MeshStandardMaterial({
      color: col,
      metalness: pbr.metallicFactor ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    })
  })

  const nodes = json.nodes || []
  const walk = (ni, parent) => {
    const n = nodes[ni]
    const world = parent ? mul(parent, nodeMatrix(n)) : nodeMatrix(n)
    const m4 = new THREE.Matrix4().fromArray(Array.from(world))
    if (n.mesh !== undefined) {
      const mesh = json.meshes[n.mesh]
      for (const prim of mesh.primitives || []) {
        if (prim.mode !== undefined && prim.mode !== 4) throw new Error('[glb] non-triangle primitive')
        const pos = decodeAccessor(json, buffer, binOff, prim.attributes.POSITION)
        const geo = new THREE.BufferGeometry()
        const arr = new Float32Array(pos.length)
        const v = new THREE.Vector3()
        for (let i = 0; i < pos.length; i += 3) {
          v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m4)
          arr[i] = v.x
          arr[i + 1] = v.y
          arr[i + 2] = v.z
        }
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
        if (prim.attributes.NORMAL !== undefined) {
          const nrm = decodeAccessor(json, buffer, binOff, prim.attributes.NORMAL)
          const narr = new Float32Array(nrm.length)
          const nm = new THREE.Matrix3().getNormalMatrix(m4)
          for (let i = 0; i < nrm.length; i += 3) {
            v.set(nrm[i], nrm[i + 1], nrm[i + 2]).applyMatrix3(nm).normalize()
            narr[i] = v.x
            narr[i + 1] = v.y
            narr[i + 2] = v.z
          }
          geo.setAttribute('normal', new THREE.BufferAttribute(narr, 3))
        } else {
          geo.computeVertexNormals()
        }
        if (prim.indices !== undefined) {
          const idx = decodeAccessor(json, buffer, binOff, prim.indices)
          const needs32 = pos.length / 3 > 65535
          geo.setIndex(new THREE.BufferAttribute(needs32 ? new Uint32Array(idx) : new Uint16Array(idx), 1))
        }
        const meshObj = new THREE.Mesh(geo, mats[prim.material] || mats[0])
        meshObj.name = mesh.name || prim.material
        root.add(meshObj)
      }
    }
    for (const c of n.children || []) walk(c, world)
  }
  for (const r of json.scenes[0].nodes) walk(r, null)
  return root
}

// loadGLB(url) -> Promise<THREE.Group>
export function loadGLB(url) {
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error('[glb] ' + r.status + ' for ' + url)
      return r.arrayBuffer()
    })
    .then(parseGLB)
}
