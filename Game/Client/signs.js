// client/signs.js — range signage: canvas-textured planes from map data.
// Presentation only (positions, sizes, and text all come from the map file).

import * as THREE from 'three'

const STYLE = {
  bg: '#55534e', // iron gray plate
  ink: '#ddd7c9', // bone lettering
  border: '#3a3835',
}

export function buildSigns(scene, signs) {
  for (const s of signs) {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = Math.max(64, Math.round((512 * s.h) / s.w))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = STYLE.bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = STYLE.border
    ctx.lineWidth = 8
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8)
    ctx.fillStyle = STYLE.ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // fit the text to the plate instead of a fixed size
    let size = Math.floor(canvas.height * 0.62)
    ctx.font = `700 ${size}px ui-monospace, Menlo, Consolas, monospace`
    while (ctx.measureText(s.text).width > canvas.width - 64 && size > 10) {
      size -= 4
      ctx.font = `700 ${size}px ui-monospace, Menlo, Consolas, monospace`
    }
    ctx.fillText(s.text, canvas.width / 2, canvas.height / 2 + 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w, s.h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.02 })
    )
    mesh.position.set(s.pos[0], s.pos[1], s.pos[2])
    mesh.rotation.y = s.rotY
    scene.add(mesh)
  }
}
