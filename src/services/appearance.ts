import { accentForeground, colorRoles, type Colors } from '../core/appearance';
export function applyAppearance(colors: Colors) {
  const root = document.documentElement;
  root.dataset.theme = 'dark';
  for (const key of Object.keys(colorRoles) as (keyof Colors)[])
    root.style.setProperty(colorRoles[key][1], colors[key]);
  root.style.setProperty('--on-accent', accentForeground(colors.accentColor));
}
