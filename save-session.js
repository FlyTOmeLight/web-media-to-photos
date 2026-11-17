class SaveSession {
  constructor() {
    this.job = null;
    this.dismissedJobId = undefined;
    this.dismissed = false;
    this.pending = false;
    this.stopping = false;
  }

  restore(job, dismissedJobId = this.dismissedJobId) {
    this.job = job || null;
    this.dismissedJobId = dismissedJobId;
    this.dismissed = Boolean(job?.id && job.id === dismissedJobId);
    if (!job?.busy && !this.pending) this.stopping = false;
  }

  begin(payload) {
    if (this.job?.busy || this.pending) return false;
    this.job = { busy: true, payload };
    this.dismissed = false;
    this.pending = true;
    this.stopping = false;
    return true;
  }

  finish(result) {
    this.job = { ...this.job, busy: false, result };
    this.pending = false;
    this.stopping = false;
  }

  stop() {
    if (!this.job?.busy || this.job.payload.action !== "save") return false;
    this.stopping = true;
    return true;
  }

  continueSelection() {
    if (this.job?.id) this.dismissedJobId = this.job.id;
    this.dismissed = true;
  }

  retryPayload(pageUrl) {
    const { payload, result } = this.job || {};
    if (this.job?.busy || this.pending || this.dismissed || payload?.action !== "save" || payload.pageUrl !== pageUrl
      || !result?.failedIndices?.length) return null;
    const images = payload.images.filter(item => result.failedIndices.includes(item.index));
    if (!images.length) return null;
    const uiSavedItems = [...new Map([...(payload.uiSavedItems || []), ...(result.items || [])]
      .map(item => [item.index, item])).values()];
    return {
      ...payload, images, uiSavedItems,
      uiUnconfirmedIndices: [...new Set([...(payload.uiUnconfirmedIndices || []), ...(result.unconfirmedIndices || [])])],
      uiUnconfirmedDetails: [...(payload.uiUnconfirmedDetails || []), ...(result.unconfirmedDetails || [])]
    };
  }

  view(note) {
    const { payload, progress, result } = this.job || {};
    const busy = Boolean(this.job?.busy || this.pending);
    const saving = busy && payload.action === "save";
    const visible = !busy && payload?.action === "save" && payload.pageUrl === note.url
      && result && !this.dismissed;
    let label = "";
    if (busy) {
      label = saving ? payload.destination === "folder" ? "正在保存…" : "正在导入…" : "请稍候…";
      if (progress) label = `${progress.phase === "import" ? "正在导入" : "正在处理"} ${progress.completed}/${progress.total}`;
      if (this.stopping) label = "正在停止…";
    }
    const outcome = visible ? this.outcome(note, payload, result) : null;
    return {
      busy, saving, label, result: outcome,
      progress: progress?.total ? progress.completed / progress.total * 100 : 0,
      canRetry: Boolean(visible && this.retryPayload(note.url))
    };
  }

  outcome(note, payload, result) {
    const unconfirmedIndices = [...new Set([...(payload.uiUnconfirmedIndices || []), ...(result.unconfirmedIndices || [])])];
    const unconfirmedDetails = [...(payload.uiUnconfirmedDetails || []), ...(result.unconfirmedDetails || [])];
    const confirmationWarning = unconfirmedIndices.length
      ? `${unconfirmedIndices.length} 张导入结果未确认，请先检查“照片”，再决定是否重新保存。` : "";
    if (payload.uiSavedItems?.length) {
      const items = [...new Map([...payload.uiSavedItems, ...(result.items || [])]
        .map(item => [item.index, item])).values()];
      result = { ...result, items, saved: items.length, ok: result.ok || items.length > 0 };
    }
    let details = [confirmationWarning, result.error || (confirmationWarning ? "" : "保存失败，请稍后再试"),
      ...unconfirmedDetails].filter(Boolean).join("\n");
    if (result.ok) {
      const local = payload.destination === "folder";
      const target = local ? "本地文件夹" : payload.albumId ? `相簿“${payload.albumName}”` : "“照片”";
      const failedText = result.failed ? `，${result.failed} 张失败` : "";
      const fallbackText = result.liveFallback ? `，${result.liveFallback} 张仅保存静态图` : "";
      const qualityText = result.qualityFallbackDetails?.length ? `，${result.qualityFallbackDetails.length} 张使用页面版本` : "";
      const unconfirmedText = unconfirmedIndices.length ? `，${unconfirmedIndices.length} 张结果未确认` : "";
      const summary = `已${local ? "保存" : "导入"} ${result.saved} 张到${target}${failedText}${fallbackText}${qualityText}${unconfirmedText}`;
      details = [result.cancelled ? "任务已停止，已保存的图片已保留" : "", summary,
        ...(result.failureDetails || []), ...(result.liveFallbackDetails || []),
        ...(result.qualityFallbackDetails || []), result.error, result.sourceWarning, result.historyWarning,
        confirmationWarning, ...unconfirmedDetails,
        local ? result.folderPath : ""].filter(Boolean).join("\n");
    }
    const markers = note.images.map((image, index) => {
      const original = image.index || index + 1;
      const saved = result.items?.find(item => item.index === original);
      const failed = result.failedIndices?.includes(original);
      const unconfirmed = unconfirmedIndices.includes(original);
      const staticFallback = saved && image.kind === "live" && saved.kind !== "live";
      return {
        text: unconfirmed ? "导入未确认" : failed ? "保存失败" : saved ? staticFallback ? "已保存 · 静态图"
          : saved.quality === "page" ? "已保存 · 页面版本" : "已保存" : "",
        warning: Boolean(unconfirmed || failed || staticFallback || saved?.quality === "page")
      };
    });
    return {
      details, summary: details.split("\n").slice(0, result.cancelled ? 2 : 1).join("\n"), markers,
      warning: !result.ok || Boolean(unconfirmedIndices.length || result.error || result.failed || result.liveFallback
        || result.qualityFallbackDetails?.length || result.cancelled || result.sourceWarning || result.historyWarning)
    };
  }
}
