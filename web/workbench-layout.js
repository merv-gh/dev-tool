/* Resizable panes with keyboard equivalents. Does not own editor or task state. */
globalThis.DTResize = function (before, after, { min = 180, max = 900, label = 'Resize panel', onResize } = {}) {
  const handle = document.createElement('div'); handle.className = 'dt-resizer'; handle.tabIndex = 0; handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical'); handle.setAttribute('aria-label', label); before.after(handle);
  const width = value => { const bound = Math.min(max, Math.max(min, value)); before.style.width = bound + 'px'; before.style.flex = '0 0 ' + bound + 'px'; handle.setAttribute('aria-valuenow', Math.round(bound)); onResize?.(bound); };
  handle.setAttribute('aria-valuemin', min); handle.setAttribute('aria-valuemax', max); handle.setAttribute('aria-valuenow', Math.round(before.getBoundingClientRect().width));
  handle.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); width(e.key === 'Home' ? min : e.key === 'End' ? max : before.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? -20 : 20)); } });
  handle.addEventListener('pointerdown', e => { const start = e.clientX, initial = before.getBoundingClientRect().width; handle.setPointerCapture(e.pointerId); const move = next => width(initial + next.clientX - start); const stop = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('pointercancel', stop); }; handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop); });
  return handle;
};
if (document.getElementById('explorer')) DTResize(document.getElementById('explorer'), document.querySelector('.editor-main'), { max: 600, label: 'Resize file explorer' });
