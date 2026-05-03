const THEME_KEY = 'nexus.theme'
const MODE_KEY = 'nexus.mode'

export const themes = [
  { value: 'indigo', label: 'Indigo' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'rose', label: 'Rose' },
  { value: 'amber', label: 'Amber' },
  { value: 'sky', label: 'Sky' },
]

export const modes = ['dark', 'light']

function safeTheme(theme) {
  return themes.some(item => item.value === theme) ? theme : 'indigo'
}

function safeMode(mode) {
  return modes.includes(mode) ? mode : 'dark'
}

export function getAppearance() {
  return {
    theme: safeTheme(localStorage.getItem(THEME_KEY)),
    mode: safeMode(localStorage.getItem(MODE_KEY)),
  }
}

export function applyAppearance(settings = getAppearance()) {
  const next = {
    theme: safeTheme(settings.theme),
    mode: safeMode(settings.mode),
  }

  document.documentElement.dataset.theme = next.theme
  document.documentElement.dataset.mode = next.mode
  return next
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, safeTheme(theme))
  const settings = applyAppearance()
  window.dispatchEvent(new CustomEvent('appearancechange', { detail: settings }))
  return settings
}

export function setMode(mode) {
  localStorage.setItem(MODE_KEY, safeMode(mode))
  const settings = applyAppearance()
  window.dispatchEvent(new CustomEvent('appearancechange', { detail: settings }))
  return settings
}

export function syncAppearanceFromStorage() {
  return applyAppearance(getAppearance())
}

window.addEventListener('storage', (event) => {
  if (event.key === THEME_KEY || event.key === MODE_KEY) {
    const settings = syncAppearanceFromStorage()
    window.dispatchEvent(new CustomEvent('appearancechange', { detail: settings }))
  }
})

syncAppearanceFromStorage()
