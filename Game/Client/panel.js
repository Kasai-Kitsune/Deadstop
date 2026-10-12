// client/panel.js — the debug panel (toggle: backtick). One live slider per numeric
// config value, a JSON export, and a reset. Sliders write straight into the SAME
// config object the sim reads each tick, so edits apply on the next tick — no reload.
//
// M2+: config groups nest one level (weapons.ar / weapons.sniper) — the walk
// below recurses, and reset deep-assigns IN PLACE so slider closures (which
// hold references to the leaf objects) keep working after a reset.

export function createPanel({ config, ranges }) {
  const DEFAULTS = structuredClone(config) // frozen at load; reset restores these
  const root = document.getElementById('panel')
  const sliders = [] // { refresh }
  let open = false

  root.innerHTML = `
    <header>
      <b>debug</b>
      <span class="hint">` + '`' + ` to close · edits apply live</span>
    </header>
    <div id="panel-body"></div>
    <footer>
      <button id="panel-export" type="button">export JSON</button>
      <button id="panel-reset" type="button">reset</button>
      <textarea id="panel-out" rows="6" spellcheck="false" aria-label="exported config JSON"></textarea>
    </footer>`

  const body = root.querySelector('#panel-body')

  // recursively lay out one config object; `path` is the dotted key prefix
  function walk(obj, path, section) {
    for (const key of Object.keys(obj)) {
      const value = obj[key]
      const full = path ? `${path}.${key}` : key
      if (typeof value === 'number') {
        addSlider(obj, key, full, value, section)
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // nested group (e.g. weapons -> ar): its own labeled sub-section
        const sub = document.createElement('section')
        const h = document.createElement('h3')
        h.textContent = full.replace('.', ' \u203a ')
        sub.appendChild(h)
        section.appendChild(sub)
        walk(value, full, sub)
      }
      // strings, booleans, arrays (recoil patterns): not sliders by design
    }
  }

  function addSlider(group, key, path, value, section) {
    const range = ranges[path]
    const row = document.createElement('div')
    row.className = 'row'
    if (!range) {
      // loud, not silent: a tunable without a slider range is a bug in config.js
      console.error('[panel] missing TUNING_RANGES entry for', path)
      row.innerHTML = `<label>${key}</label><span class="warn">no range</span>`
      section.appendChild(row)
      return
    }
    const [min, max, step] = range
    row.innerHTML = `
      <label>${key}</label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${path}">
      <output>${fmt(value)}</output>`
    const input = row.querySelector('input')
    const out = row.querySelector('output')
    input.addEventListener('input', () => {
      group[key] = parseFloat(input.value)
      out.textContent = fmt(group[key])
    })
    sliders.push({
      refresh() {
        input.value = group[key]
        out.textContent = fmt(group[key])
      },
    })
    section.appendChild(row)
  }

  for (const groupName of Object.keys(config)) {
    const section = document.createElement('section')
    const h = document.createElement('h3')
    h.textContent = groupName
    section.appendChild(h)
    walk(config[groupName], groupName, section)
    body.appendChild(section)
  }

  root.querySelector('#panel-export').addEventListener('click', () => {
    const json = JSON.stringify(config, null, 2)
    const out = root.querySelector('#panel-out')
    out.value = json
    out.hidden = false
    out.select()
    // try a clipboard write; the visible textarea is the fallback either way
    navigator.clipboard?.writeText(json).catch(() => {})
    // also offer a download
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'config.json'
    a.click()
    URL.revokeObjectURL(a.href)
  })

  root.querySelector('#panel-reset').addEventListener('click', () => {
    deepAssign(config, DEFAULTS) // in place, all levels: the sim keeps its references
    for (const s of sliders) s.refresh()
  })

  return {
    isOpen: () => open,
    toggle() {
      open = !open
      root.classList.toggle('open', open)
      if (open && document.pointerLockElement) document.exitPointerLock()
    },
  }
}

// mutate `target` to match `source` without replacing nested objects, so
// closures holding leaf references (sliders, the sim) see the reset
function deepAssign(target, source) {
  for (const k of Object.keys(source)) {
    const v = source[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepAssign(target[k], v)
    } else {
      target[k] = v
    }
  }
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '')
}
