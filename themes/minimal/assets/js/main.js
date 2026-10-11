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
  });
})();
