/**
 * Default 主题的短代码示例：警示框。
 *
 * 短代码的**机制**由内核提供（引擎在访问者浏览器里解析正文标记），
 * 具体语义完全由主题定义 —— 内核不内置任何短代码，本文件就是一份参照样板。
 *
 * 作者在正文里这样写：
 *
 *     [warn title="注意"]这里是内容[/warn]
 *
 * 引擎会把它替换成下面这套结构，样式见 `css/style.css` 的 `.df-warn`。
 *
 * 两点值得留意：
 * - `bodyHtml` 是作者内容经**服务端渲染并消毒**后的片段，段落、列表、图片都会保留，
 *   直接插入即可；若要把某段内容当纯文本用，改用 `bodyText`，或对字符串用
 *   `context.escapeHtml()` 转义后再拼接（本示例返回 DOM 节点，因此无需手工转义）。
 * - 正文标记之间的内容支持跨段落，因此 `bodyHtml` 常含多个 `<p>`。
 */
(function () {
  'use strict';

  /*
   * 引擎脚本由 layout.njk 里的 `shortcode_runtime()` 引入，与本文件同为 defer，
   * 正常情况下此时 `window.RiceNoteShortcodes` 已就绪。若某个页面把它排在本文件
   * 之后（或引擎产物缺失），退回预注册队列 —— 引擎加载时会消费队列里的定义，
   * 因此注册顺序不会影响最终效果。
   */
  var api = window.RiceNoteShortcodes;
  var define =
    api && typeof api.define === 'function'
      ? function (definition) {
          api.define(definition);
        }
      : function (definition) {
          window.RiceNoteShortcodesQueue = window.RiceNoteShortcodesQueue || [];
          window.RiceNoteShortcodesQueue.push(definition);
        };

  define({
    name: 'warn',

    /**
     * @param {object} context 渲染上下文
     * @param {Record<string,string>} context.attributes 标记上的参数（title、flag…）
     * @param {string} context.bodyHtml 标记之间已消毒的 HTML 片段
     * @param {string} context.bodyText 同上内容的纯文本形式
     * @returns {Node} 要插入正文的结构
     */
    render: function (context) {
      var box = document.createElement('div');
      box.className = 'df-warn';

      var title = context.attributes.title;
      if (title) {
        var heading = document.createElement('p');
        heading.className = 'df-warn__title';
        // 参数是作者写的文字，当纯文本处理，避免其中的尖括号被当作标签
        heading.textContent = title;
        box.appendChild(heading);
      }

      var body = document.createElement('div');
      body.className = 'df-warn__body';
      // 正文片段已由服务端渲染并消毒，这里直接放入
      body.innerHTML = context.bodyHtml;
      box.appendChild(body);

      return box;
    }
  });
})();
