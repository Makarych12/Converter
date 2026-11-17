/**
 * Copy & Share Engine: запись в буфер, визуальный фидбек кнопки (✅ «Скопировано!» на 1.5 с) и Toast.
 */

export const ICON_COPY = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>';
export const ICON_CHECK = '<svg class="icon icon--check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const FEEDBACK_MS = 1500;

/** Запись текста: Clipboard API, а в небезопасном контексте — запасной путь через execCommand. */
export async function writeClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* например, нет фокуса документа — пробуем запасной путь */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/**
 * Копирует текст и показывает фидбек.
 * В отличие от наивной реализации, повторный клик в течение 1.5 с не «запоминает»
 * состояние «Скопировано!» как исходное — оригинальная разметка хранится один раз.
 */
export async function copyToClipboard(text, buttonElement, { toastText = 'Скопировано в буфер обмена!' } = {}) {
  const ok = await writeClipboard(text);
  if (!ok) {
    showToast('Не удалось скопировать — браузер запретил доступ к буферу', 'error');
    return false;
  }

  if (buttonElement) {
    clearTimeout(buttonElement._copyTimer);
    if (buttonElement._originalContent == null) buttonElement._originalContent = buttonElement.innerHTML;
    buttonElement.innerHTML = `${ICON_CHECK}<span class="copy-label">Скопировано!</span>`;
    buttonElement.classList.add('is-copied');
    buttonElement._copyTimer = setTimeout(() => {
      buttonElement.innerHTML = buttonElement._originalContent;
      buttonElement._originalContent = null;
      buttonElement.classList.remove('is-copied');
    }, FEEDBACK_MS);
  }

  navigator.vibrate?.(12);
  showToast(toastText, 'success', text);
  return true;
}

let toastTimer = null;

export function showToast(message, type = 'info', detail = '') {
  const host = document.getElementById('toast');
  if (!host) return;
  host.className = `toast toast--${type}`;
  host.innerHTML = `${type === 'success' ? ICON_CHECK : ''}<div class="toast__body"><span class="toast__msg"></span>${detail ? '<span class="toast__detail"></span>' : ''}</div>`;
  host.querySelector('.toast__msg').textContent = message;
  if (detail) host.querySelector('.toast__detail').textContent = detail.length > 90 ? `${detail.slice(0, 90)}…` : detail;
  host.hidden = false;
  // перезапуск анимации
  host.classList.remove('is-visible');
  void host.offsetWidth;
  host.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    host.classList.remove('is-visible');
    setTimeout(() => { if (!host.classList.contains('is-visible')) host.hidden = true; }, 250);
  }, 2200);
}
