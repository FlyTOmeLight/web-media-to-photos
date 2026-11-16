#!/bin/zsh
set -euo pipefail

source_dir="${0:A:h}"
if ! python_path="$(command -v python3)"; then
  print -u2 '未找到 Python 3。请安装 Python 3.10 或更新版本，再运行安装程序。'
  exit 1
fi
"$python_path" "$source_dir/install.py"
# Move the pre-rename connector (红薯收藏夹 / com.rednote.photosaver) aside.
legacy_support="$HOME/Library/Application Support/红薯收藏夹"
legacy_manifest="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.rednote.photosaver.json"
previous_manifest="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.local.media-photos.json"
stamp="$(date +%Y%m%d-%H%M%S)"
if [[ -f "$legacy_manifest" ]]; then
  mv "$legacy_manifest" "$HOME/.Trash/com.rednote.photosaver-$stamp.json"
fi
if [[ -f "$previous_manifest" ]]; then
  mv "$previous_manifest" "$HOME/.Trash/com.local.media-photos-$stamp.json"
fi
if [[ -d "$legacy_support" ]]; then
  mv "$legacy_support" "$HOME/.Trash/红薯收藏夹-$stamp"
fi
if [[ -t 0 ]]; then
  read -k 1 '?按任意键关闭…'
  print
fi
