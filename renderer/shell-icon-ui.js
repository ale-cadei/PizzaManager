/* Scelta dell'icona per una singola shell. La scelta manuale prevale sempre. */
function shellIconOf(tab) {
  return tab && tab.type === 'shell' ? ShellIcons.normalize(tab.iconKey) : tab.type;
}

function setShellIcon(tab, key, mode) {
  if (!tab || tab.type !== 'shell') return;
  const next = ShellIcons.normalize(key);
  const nextMode = mode === 'manual' ? 'manual' : 'auto';
  if (tab.iconKey === next && tab.iconMode === nextMode) return;
  tab.iconKey = next;
  tab.iconMode = nextMode;
  if (tab.session && tab.alive) window.aisess.setMeta(tab.id, { iconKey: next, iconMode: nextMode });
  renderSidebar();
}

function observeShellIconInput(tab, data) {
  if (tab.type !== 'shell' || tab.iconMode === 'manual' || tab.iconKey !== 'shell') return;
  const found = tab.iconCapture.feed(data);
  if (found) setShellIcon(tab, found, 'auto');
}

function openShellIconPicker(tab) {
  if (!tab || tab.type !== 'shell') return;
  const modal = $('#modal-shell-icon');
  const choices = $('#shell-icon-choices');
  const close = () => { modal.hidden = true; modal.onclick = null; modal.onkeydown = null; };
  choices.replaceChildren();

  const options = [{ key: 'auto', label: 'Automatico', description: 'Riconosci dai comandi' },
    ...ShellIcons.CHOICES.map((c) => ({ ...c, description: c.key === 'shell' ? 'Mantieni il terminale' : 'Icona fissa' }))];
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shell-icon-choice';
    const selected = option.key === 'auto'
      ? tab.iconMode !== 'manual'
      : tab.iconMode === 'manual' && tab.iconKey === option.key;
    button.setAttribute('aria-pressed', String(selected));
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.innerHTML = Icons.markup(option.key === 'auto' && tab.iconMode === 'manual' ? 'shell'
      : option.key === 'auto' ? shellIconOf(tab) : option.key);
    const label = document.createElement('span');
    label.className = 'shell-icon-choice-label';
    label.textContent = option.label;
    const description = document.createElement('span');
    description.className = 'shell-icon-choice-sub';
    description.textContent = option.description;
    button.append(icon, label, description);
    button.onclick = () => {
      if (option.key === 'auto') {
        if (tab.iconMode === 'manual') {
          tab.iconCapture = ShellIcons.createCommandCapture();
          setShellIcon(tab, 'shell', 'auto');
        }
      } else setShellIcon(tab, option.key, 'manual');
      close();
    };
    choices.appendChild(button);
  }
  modal.hidden = false;
  modal.onclick = (e) => { if (e.target === modal || e.target.id === 'shell-icon-close') close(); };
  modal.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  choices.querySelector('[aria-pressed="true"]')?.focus();
}
