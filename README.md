# 面接想定問答 暗記ノート

個人用の面接練習ノートです。公開URL: https://mensetsu-anki.vercel.app/

複数の「問答セット（デッキ）」を切り替えながら、暗記モード（フラッシュカード）・一覧モード・未回答リストで練習できます。進捗はブラウザのlocalStorageにのみ保存され、どこにも送信されません。

## 構成

- `index.html`: ページ構造（デッキ選択、暗記/一覧/未回答/動画タブ）
- `style.css`: スタイル
- `app.js`: アプリ本体（データ読み込み・暗記モード・一覧・未回答リストのロジック）
- `data.js`: 各デッキの質問・回答データ（xlsxから生成。手動編集は再生成で上書きされる想定）
- `videos/`: デッキごとの読み上げ動画（あるデッキのみ）

現在のデッキ:

- `general` — 一般の想定問答
- `mst` — MST（材料科学技術振興財団）
- `accenture` — アクセンチュア（一次面接対策）
- `accenture-0817` — アクセンチュア（模擬面接 0817、動画つき）
- `accenture-2ji` — アクセンチュア（二次面接対策）

## ローカル確認

```powershell
npm.cmd run check
npm.cmd run dev
```

ブラウザで `http://localhost:3000` を開きます。

## Vercelへ公開

VercelでこのリポジトリをImportします。Framework Presetは `Other`、Build CommandとOutput Directoryは空欄のままで公開できます。

このページには氏名や健康・配慮に関する個人情報が含まれます。検索エンジンには載らない設定ですが、URLを知る人は閲覧できます。必要に応じてVercelのDeployment Protectionを有効にしてください。
