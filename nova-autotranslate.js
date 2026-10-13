/* Nova Messenger translation prototype.
 * Local test API: LibreTranslate on this computer only.
 * This does not send or store a modified message; translations live in the UI cache.
 */
(() => {
  'use strict';

  const API_BASE = String(window.NOVA_TRANSLATE_API || 'http://127.0.0.1:5000').replace(/\/$/, '');
  const cache = new Map();
  const pending = new Map();

  const messageText = (row) => row?.querySelector('.msg-content')?.innerText?.trim() || '';

  async function postJson(path, payload) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors'
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error || ''; } catch (_) {}
      throw new Error(detail || `Сервис перевода ответил с кодом ${response.status}.`);
    }
    return response.json();
  }

  async function detectTarget(text) {
    try {
      const detected = await postJson('/detect', { q: text });
      const language = Array.isArray(detected) && detected[0] ? detected[0].language : '';
      // For the RU/EN alliance chat use the opposite language. Other source languages go to Russian.
      return String(language).toLowerCase().startsWith('ru') ? 'en' : 'ru';
    } catch (error) {
      // If detection is unavailable, keep the default target useful for a Russian-speaking user.
      if (error instanceof TypeError) throw error;
      return 'ru';
    }
  }

  function getOrCreateResult(row) {
    let result = row.querySelector('.nova-translation-result');
    if (!result) {
      result = document.createElement('div');
      result.className = 'nova-translation-result';
      result.hidden = true;
      const content = row.querySelector('.msg-content');
      if (content) content.insertAdjacentElement('afterend', result);
    }
    return result;
  }

  function renderResult(row, entry) {
    const result = getOrCreateResult(row);
    result.replaceChildren();
    const label = document.createElement('span');
    label.className = 'nova-translation-label';
    label.textContent = entry.label || 'Перевод';
    result.append(label, document.createTextNode(entry.text || ''));
    result.classList.toggle('nova-translation-error', !!entry.error);
    result.hidden = false;
    return result;
  }

  function showError(row, message) {
    renderResult(row, { label: 'Ошибка перевода', text: message, error: true });
  }

  async function translateButton(button) {
    const row = button.closest('[data-message-id]');
    const id = row?.dataset.messageId;
    const text = messageText(row);
    if (!row || !id || !text) return;

    const cached = cache.get(id);
    if (cached) {
      const result = getOrCreateResult(row);
      result.hidden = !result.hidden;
      return;
    }
    if (pending.has(id)) return;

    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    button.title = 'Переводим…';
    const task = (async () => {
      try {
        const target = await detectTarget(text);
        const translated = await postJson('/translate', { q: text, source: 'auto', target, format: 'text' });
        if (typeof translated.translatedText !== 'string') throw new Error('Сервис не вернул текст перевода.');
        const entry = { text: translated.translatedText, label: target === 'en' ? 'English translation' : 'Перевод на русский', target };
        cache.set(id, entry);
        renderResult(row, entry);
        button.title = 'Скрыть или показать перевод';
      } catch (error) {
        const message = error instanceof TypeError
          ? 'Не удалось подключиться к локальному LibreTranslate. Проверьте, что сервер запущен и разрешён CORS для страницы мессенджера.'
          : (error?.message || 'Не удалось перевести сообщение.');
        showError(row, message);
        button.title = 'Повторить перевод';
      } finally {
        pending.delete(id);
        button.removeAttribute('aria-busy');
        button.disabled = false;
      }
    })();
    pending.set(id, task);
    await task;
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-nova-translate]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    translateButton(button);
  });

  // Re-attach cached translations if renderMessages() rebuilds the message DOM.
  const observer = new MutationObserver(() => {
    document.querySelectorAll('#message-feed [data-message-id]').forEach((row) => {
      const entry = cache.get(row.dataset.messageId);
      if (entry && !row.querySelector('.nova-translation-result')) {
        const result = getOrCreateResult(row);
        const label = document.createElement('span');
        label.className = 'nova-translation-label';
        label.textContent = entry.label;
        result.append(label, document.createTextNode(entry.text));
        result.hidden = true;
      }
    });
  });
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
})();
