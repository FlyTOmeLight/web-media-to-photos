(() => {
  const collectionCard = (api, name, image, caption) => {
    const active = api.state.target === "photos" && api.state.album === name;
    return `<button type="button" class="forest-collection ${active ? "is-current" : ""}"
      data-action="shortcut-target" data-value="${name}" aria-pressed="${active}"
      ${api.state.status !== "idle" ? "disabled" : ""}>
      <img src="../interaction-prototype/assets/${image}.jpg" alt="">
      <span class="forest-collection-copy"><strong>${name}</strong><small>${caption}</small></span>
      <span class="forest-collection-check">${api.icon(active ? "check" : "photos")}</span>
    </button>`;
  };

  window.CONCEPTS.push(
    {
      id: "06",
      name: "林间藏品",
      english: "Forest collection",
      subtitle: "先为灵感找个相簿，再挑喜欢的画面。",
      audience: "适合习惯按主题相簿整理旅行与日常灵感的人。",
      rationale: "把相簿卡片放在媒体前面，让归档意图先于批量选择。",
      tradeoff: "相簿入口占据首屏空间，查看全部媒体需要向下滚动。",
      flow: ["选相簿或文件夹", "筛选并勾选媒体", "后台保存并查看结果"],
      colors: ["#173E32", "#F1F4EB", "#CBD9BD"],
      kind: "popup",
      width: 440,
      themeId: "forest", themeTokens: ["#f1f4eb", "#173e32", "#cbd9bd"],
      render(api) {
        return `${api.header()}
          <section class="forest-intro">
            <span class="forest-leaf" aria-hidden="true">${api.icon("leaf")}</span>
            <div><h2>给灵感，留一片地方。</h2><p>先选去处，再收下喜欢的画面。</p></div>
          </section>
          <section class="forest-shelf" aria-label="选择收藏相簿">
            <div class="forest-section-title"><h3>收藏到</h3><span>Photos 相簿</span></div>
            <div class="forest-collections">
              ${collectionCard(api, "旅行灵感", "forest", "山野、海边与远方")}
              ${collectionCard(api, "日常收藏", "coffee", "平常日子的小片刻")}
            </div>
            ${api.destination()}
          </section>
          <section class="forest-media" aria-label="选择当前页面媒体">
            ${api.source()}${api.tools()}
            ${api.gallery({ layout: "masonry", columns: 2, limit: 6 })}
          </section>
          <footer class="forest-footer">${api.action()}</footer>`;
      }
    },
    {
      id: "07",
      name: "工作清单",
      english: "Save queue",
      subtitle: "逐行扫过媒体，把一次保存做得利落。",
      audience: "适合需要快速核对媒体类型、逐项选择和保存的用户。",
      rationale: "缩略图与行信息并排，减少纵向浏览成本，底部集中目的地与任务操作。",
      tradeoff: "紧凑缩略图弱化画面细节，精看时需要打开单项预览。",
      flow: ["筛选并逐行勾选", "核对保存位置", "保存并处理失败项"],
      colors: ["#F2F3F5", "#292D33", "#BD4918"],
      kind: "popup",
      width: 400,
      interaction: "清单式核对",
      render(api) {
        return `${api.header()}
          <div class="queue-page">
            <div class="queue-heading"><h2>当前页面清单</h2><span>${api.count} 项已选</span></div>
            ${api.source()}${api.tools()}
            <section class="queue-table" aria-label="媒体清单">
              <div class="queue-columns" aria-hidden="true"><span>媒体 / 类型</span><span>选择与预览</span></div>
              ${api.gallery({ layout: "list", columns: 2, limit: 6 })}
            </section>
          </div>
          <footer class="queue-footer">
            ${api.destination()}${api.action()}
          </footer>`;
      }
    },
    {
      id: "08",
      name: "逐步引导",
      english: "One step at a time",
      subtitle: "选好、放好、确认好，一步只做一件事。",
      audience: "适合首次使用、希望明确知道下一步做什么的用户。",
      rationale: "真实拆分三个操作页面，保留返回修改入口，保存状态始终留在最终步骤。",
      tradeoff: "保存前需要切换步骤，比同屏批量操作多一次确认。",
      flow: ["选择页面媒体", "选择相簿或文件夹", "确认数量并后台保存"],
      colors: ["#3764A5", "#FBFAF6", "#E7EFFB"],
      kind: "popup",
      width: 400,
      interaction: "分步引导",
      render(api) {
        const locked = api.state.status !== "idle";
        const step = locked ? 3 : api.state.step;
        const titles = ["选喜欢的画面", "给它们选个去处", "确认后，就可以保存"];
        const descriptions = ["点选要保存的媒体，也可以先放大看看。", "存入 Photos 相簿，或保存到本地文件夹。", "检查数量与位置，保存会在后台继续。"];
        const navigation = ["选媒体", "选位置", "确认保存"].map((label, index) =>
          `<button type="button" class="guide-step ${step === index + 1 ? "is-current" : ""} ${step > index + 1 ? "is-complete" : ""}"
            data-action="set-step" data-value="${index + 1}"
            ${step === index + 1 ? 'aria-current="step"' : ""}
            ${locked || (index > 0 && !api.count) ? "disabled" : ""}>
            <span>${step > index + 1 ? api.icon("check") : index + 1}</span><strong>${label}</strong>
          </button>`
        ).join("");
        let content;
        if (step === 1) {
          content = `${api.tools()}${api.gallery({ layout: "grid", columns: 2, limit: 6 })}
            <footer class="guide-navigation"><span>已选 ${api.count} 项</span>
              <button type="button" class="primary" data-action="next-step" ${api.count ? "" : "disabled"}>
                选择保存位置 ${api.icon("arrow")}
              </button>
            </footer>`;
        } else if (step === 2) {
          content = `<div class="guide-place-icon" aria-hidden="true">${api.icon(api.state.target === "folder" ? "folder" : "photos")}</div>
            <section class="guide-destination" aria-label="保存位置">${api.destination()}</section>
            <p class="guide-place-note">已选的 ${api.count} 项媒体会保存到这里。</p>
            <footer class="guide-navigation">
              <button type="button" class="quiet" data-action="prev-step">${api.icon("back")} 返回选图</button>
              <button type="button" class="primary" data-action="next-step" ${api.count ? "" : "disabled"}>核对并保存 ${api.icon("arrow")}</button>
            </footer>`;
        } else {
          content = `<section class="guide-summary" aria-label="保存摘要">
              <span class="guide-summary-icon" aria-hidden="true">${api.icon("check")}</span>
              <div><strong>${api.count} 项媒体</strong><p>保留你刚刚的选择</p></div>
              <button type="button" class="quiet" data-action="set-step" data-value="1" ${locked ? "disabled" : ""}>修改</button>
            </section>
            ${api.destination()}
            <div class="guide-save">${api.action()}</div>
            <button type="button" class="quiet guide-back" data-action="prev-step" ${locked ? "disabled" : ""}>${api.icon("back")} 返回选择位置</button>`;
        }
        return `${api.header()}
          <nav class="guide-steps" aria-label="保存步骤">${navigation}</nav>
          <div class="guide-page">
            <div class="guide-title"><h2>${titles[step - 1]}</h2><p>${descriptions[step - 1]}</p></div>
            ${step === 1 ? api.source() : ""}
            <div class="guide-stage guide-stage-${step}">${content}</div>
          </div>`;
      }
    },
    {
      id: "09",
      name: "双栏工作",
      english: "Media workbench",
      subtitle: "在独立页面里，一边选图，一边检查细节。",
      audience: "适合频繁批量归档、需要连续对照画面细节的重度用户。",
      rationale: "左侧承担筛选与选择，右侧持续预览，目的地和任务操作固定在工作区底部。",
      tradeoff: "760 像素工作区需要独立页面承载，不适合直接作为浏览器窄弹窗。",
      flow: ["左栏批量选择", "右栏切换并核对预览", "底部选位置并保存"],
      colors: ["#26384C", "#F4F6F8", "#DCE5EE"],
      kind: "workspace",
      width: 760,
      interaction: "独立双栏工作台",
      render(api) {
        const selected = api.state.selected.has(api.state.focus);
        return `${api.header()}
          <div class="workbench-heading"><h2>媒体工作台</h2><span>${api.icon("grid")} 独立页面</span></div>
          <div class="workbench-columns">
            <section class="workbench-browser" aria-label="筛选与选择媒体">
              ${api.source()}${api.tools()}
              ${api.gallery({ layout: "grid", columns: 3, limit: 6 })}
              <p class="workbench-selection-note">点选卡片加入保存，右侧缩略图切换预览。</p>
            </section>
            <section class="workbench-inspector" aria-label="当前媒体预览">
              <div class="workbench-preview-heading"><h3>画面检查</h3>
                <button type="button" class="quiet" data-action="preview" data-index="${api.state.focus}" aria-label="放大当前媒体">${api.icon("zoom")}</button>
              </div>
              ${api.hero()}${api.filmstrip()}${api.detail()}
              <button type="button" class="quiet workbench-pick ${selected ? "is-selected" : ""}"
                data-action="toggle" data-index="${api.state.focus}" aria-pressed="${selected}"
                ${api.state.status !== "idle" ? "disabled" : ""}>
                ${api.icon(selected ? "check" : "photos")}${selected ? "已加入本次保存" : "加入本次保存"}
              </button>
            </section>
          </div>
          <footer class="workbench-footer">
            <div class="workbench-target">${api.destination()}</div>
            <div class="workbench-save">${api.action()}</div>
          </footer>`;
      }
    },
    {
      id: "10",
      name: "轻快贴纸",
      english: "Little keeps",
      subtitle: "把喜欢的画面，贴进自己的收藏。",
      audience: "适合随手保存生活灵感、偏好轻快视觉反馈的用户。",
      rationale: "用硬边照片、清楚的选中标记与数量贴纸，让点选和确认更直观。",
      tradeoff: "装饰与大幅两列照片占用空间，信息密度低于清单。",
      flow: ["点选喜欢的画面", "确认数量与保存位置", "后台保存并查看结果"],
      colors: ["#F5D956", "#25231F", "#F5CADB"],
      kind: "popup",
      width: 400,
      themeId: "sticker", themeTokens: ["#fffdf3", "#f5d956", "#25231f"],
      render(api) {
        return `${api.header()}
          <section class="sticker-intro">
            <div><h2>喜欢，就收下。</h2><p>为下一次翻到它，留个位置。</p></div>
            <span class="sticker-heart" aria-hidden="true">${api.icon("heart")}</span>
          </section>
          <div class="sticker-page">
            ${api.source()}${api.tools()}
            ${api.gallery({ layout: "grid", columns: 2, limit: 6 })}
          </div>
          <footer class="sticker-footer">
            <div class="sticker-confirm"><span class="sticker-count">${api.icon("check")} 选好 ${api.count} 项</span><span>再看一眼，存到这里</span></div>
            ${api.destination()}${api.action()}
          </footer>`;
      }
    }
  );
})();
