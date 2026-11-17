window.CONCEPTS.push(
  {
    id: "01", name: "原生轻巧", english: "Quiet native",
    subtitle: "打开，选好，带回照片。",
    audience: "每天随手收藏、希望操作越少越好的人。",
    rationale: "沿用 Mac 熟悉的工具栏与照片网格，把保存位置和主操作固定在底部。",
    tradeoff: "操作最直接；大量媒体的细节比较需要打开预览。",
    flow: ["默认全选当前媒体", "按需调整相簿", "一次导入，逐项反馈"],
    colors: ["#f6f7fa", "#2964d9", "#23324a"], kind: "popup", width: 400,
    themeId: "native", themeTokens: ["#ffffff", "#2964d9", "#243047"],
    render: api => `${api.header()}<div class="native-body">${api.source()}${api.tools()}${api.gallery({columns: 3})}</div><div class="native-bottom">${api.destination()}${api.action()}</div>`
  },
  {
    id: "02", name: "珊瑚随收", english: "Coral pocket",
    subtitle: "把喜欢的，放进口袋。",
    audience: "从小红书与 X 随手收藏、喜欢明快色彩的人。",
    rationale: "用红色动作区与两列大缩略图建立视觉重心，常用相簿一步切换。",
    tradeoff: "图片更好辨认；单屏容纳的数量比三列网格少。",
    flow: ["看大图，点选喜欢", "点选常用相簿", "确认数量后保存"],
    colors: ["#fff7f7", "#cf2849", "#ffc8d1"], kind: "popup", width: 400,
    themeId: "coral", defaultTheme: true, themeTokens: ["#fff8f9", "#bc2344", "#fce5eb"],
    render: api => `${api.header()}<section class="red-intro"><span>今天的心动</span><h2>喜欢，就收好。</h2><p>从网页到你的照片，只差一步。</p></section><div class="red-body">${api.source()}<div class="album-shortcuts"><button data-action="shortcut-target" data-value="旅行灵感" aria-pressed="${api.state.album === "旅行灵感"}">${api.icon("photos")}旅行灵感</button><button data-action="shortcut-target" data-value="日常收藏" aria-pressed="${api.state.album === "日常收藏"}">${api.icon("heart")}日常收藏</button></div>${api.tools()}${api.gallery({columns: 2})}</div>${api.destination()}${api.action()}`
  },
  {
    id: "03", name: "暗房精选", english: "The darkroom",
    subtitle: "放大看，再决定留下。",
    audience: "想仔细检查构图、画面细节的摄影与视觉爱好者。",
    rationale: "大图先行，底部胶片带切换预览，选择动作与浏览动作分开。",
    tradeoff: "单张审阅更沉浸；快速批量选图不如网格高效。",
    flow: ["胶片带切换大图", "逐张选择或取消", "将精选导入相簿"],
    colors: ["#25262b", "#c9d7ff", "#949ba9"], kind: "popup", width: 440,
    themeId: "darkroom", themeTokens: ["#25262b", "#c9d7ff", "#b0b4c0"],
    render: api => `${api.header()}<div class="darkroom-title">${api.source()}</div>${api.hero()}${api.filmstrip()}<div class="darkroom-inspector">${api.detail()}<button class="quiet" data-action="toggle" data-index="${api.state.focus}" aria-pressed="${api.state.selected.has(api.state.focus)}">${api.icon("check")}${api.state.selected.has(api.state.focus) ? "已加入精选" : "加入精选"}</button></div>${api.tools()}${api.destination()}${api.action()}`
  },
  {
    id: "04", name: "生活剪报", english: "Collected moments",
    subtitle: "一页灵感，一份自己的收藏。",
    audience: "收藏旅行、家居和生活灵感，重视浏览节奏的人。",
    rationale: "用杂志式标题与错落照片保留内容的纵横比例，减少裁切干扰。",
    tradeoff: "画面更有呼吸感；瀑布流中的顺序不如规则网格直观。",
    flow: ["纵览原比例照片", "勾选需要的片段", "收进同一主题相簿"],
    colors: ["#faf8f3", "#495c4c", "#c7bfae"], kind: "popup", width: 440,
    interaction: "瀑布流浏览",
    render: api => `${api.header()}<div class="journal-body"><div class="journal-masthead"><span>生活里，值得留下的。</span><h2>周末，<br>去有风的地方。</h2><div class="journal-rule"><span>收藏手记</span><span>6 个片段</span></div></div>${api.source()}${api.tools()}${api.gallery({layout: "masonry",columns: 2})}<div class="journal-footer">${api.destination()}${api.action()}</div></div>`
  },
  {
    id: "05", name: "快捷收纳", english: "Quick capture",
    subtitle: "少一点点击，多一点顺手。",
    audience: "频繁保存、偏爱键盘操作的熟练用户。",
    rationale: "用紧凑网格配合清楚的键盘提示，位置选择与保存集中在同一区域。",
    tradeoff: "熟悉后很快；首次使用需要认识快捷键。",
    flow: ["按 1–6 勾选媒体", "A 全选，P 改位置", "Enter 保存，Esc 退出弹层"],
    colors: ["#f2f0fc", "#6345b6", "#303047"], kind: "popup", width: 400,
    interaction: "键盘快捷操作",
    render: api => `${api.header()}<div class="quick-bar">${api.icon("bolt")}<span>当前页面已就绪</span><kbd>1–6</kbd></div><div class="quick-body">${api.source()}${api.tools()}${api.gallery({columns: 3})}<div class="shortcut-legend"><span><kbd>A</kbd> 全选</span><span><kbd>P</kbd> 位置</span><span><kbd>↵</kbd> 保存</span></div></div><div class="quick-bottom">${api.destination()}${api.action()}</div>`
  }
);
