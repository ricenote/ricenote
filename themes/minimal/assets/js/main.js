/**
 * Minimal 主题的前端脚本。
 *
 * 只做"增强"而非"必需"：主题在没有 JavaScript 的情况下也必须可用
 * （服务端渲染已保证内容完整可读）。
 */
(function () {
  'use strict';

  /** 键盘快捷键：按 "/" 聚焦搜索框。 */
  function bindSearchShortcut() {
    var input = document.querySelector('.rn-search-form input[name="q"]');
    if (!input) return;

    document.addEventListener('keydown', function (event) {
      var target = event.target;
      var tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) return;

      if (event.key === '/') {
        event.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  /** 代码块横向滚动提示：溢出时添加类名，便于样式提示。 */
  function markScrollableCodeBlocks() {
    var blocks = document.querySelectorAll('.rn-prose pre');
    Array.prototype.forEach.call(blocks, function (block) {
      if (block.scrollWidth > block.clientWidth + 4) {
        block.classList.add('is-scrollable');
      }
    });
  }

  /** 图片加载失败时降级为可辨识的占位样式。 */
  function handleBrokenImages() {
    var images = document.querySelectorAll('.rn-prose img, .rn-post-card__cover img');
    Array.prototype.forEach.call(images, function (image) {
      image.addEventListener('error', function () {
        image.classList.add('is-broken');
        image.setAttribute('alt', image.getAttribute('alt') || '图片加载失败');
      });
    });
  }

  /**
   * 评论区增强。
   *
   * 只做"更好"而非"必需"：表单在 `action="/comments/submit"` 下无需 JavaScript
   * 也能提交（服务端 302 回文章页并带上结果参数），这里只是改为就地反馈。
   */
  function bindComments() {
    var root = document.querySelector('[data-rn-comments]');
    if (!root) return;

    var form = root.querySelector('[data-rn-comment-form]');
    if (!form) return;

    bindReply(root, form);
    bindCommentSubmit(form);
  }

  /** "回复"按钮：设置 parentId 并聚焦输入框；提示条可取消。 */
  function bindReply(root, form) {
    var parentInput = form.querySelector('[data-rn-parent-id]');
    var hint = form.querySelector('[data-rn-replying]');
    var hintText = form.querySelector('[data-rn-replying-text]');
    var cancel = form.querySelector('[data-rn-cancel-reply]');
    if (!parentInput || !hint) return;

    var clear = function () {
      parentInput.value = '';
      hint.hidden = true;
      if (hintText) hintText.textContent = '';
    };

    root.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-rn-reply]') : null;
      if (!button) return;
      event.preventDefault();

      parentInput.value = button.getAttribute('data-comment-id') || '';
      if (hintText) {
        hintText.textContent = '正在回复 ' + (button.getAttribute('data-author') || '该评论') + '。';
      }
      hint.hidden = false;

      var textarea = form.querySelector('textarea[name="content"]');
      if (textarea) textarea.focus();
    });

    if (cancel) cancel.addEventListener('click', clear);
    form.addEventListener('reset', clear);
  }

  /** 拦截提交：走 JSON 接口就地反馈，避免整页跳转。 */
  function bindCommentSubmit(form) {
    if (!window.fetch) return;

    var message = form.querySelector('[data-rn-comment-message]');
    var submit = form.querySelector('.rn-comments__submit');

    var show = function (text, ok) {
      if (!message) return;
      message.textContent = text;
      message.hidden = false;
      message.classList.toggle('is-ok', ok);
      message.classList.toggle('is-error', !ok);
    };

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var payload = {};
      new FormData(form).forEach(function (value, key) {
        payload[key] = value;
      });

      if (submit) submit.disabled = true;
      show('正在提交…', true);

      fetch('/comments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          return response.json().then(function (body) {
            return { ok: response.ok, body: body };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            var detail = result.body && result.body.error ? result.body.error.message : '';
            throw new Error(detail || '评论提交失败，请稍后重试。');
          }

          form.reset();
          var status = result.body && result.body.data ? result.body.data.status : '';
          if (status === 'approved') {
            show('评论已发布，即将刷新显示。', true);
            window.setTimeout(function () {
              window.location.reload();
            }, 800);
            return;
          }
          show('评论已提交，审核通过后将会公开显示。', true);
        })
        .catch(function (error) {
          show(error && error.message ? error.message : '评论提交失败，请稍后重试。', false);
        })
        .then(function () {
          if (submit) submit.disabled = false;
        });
    });
  }

  function ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback);
    } else {
      callback();
    }
  }

  ready(function () {
    bindSearchShortcut();
    markScrollableCodeBlocks();
    handleBrokenImages();
    bindComments();
  });
})();
