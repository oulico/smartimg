import { readFileSync } from 'node:fs'
import { buildImageUrl, IMAGE_PRESETS, type ImagePreset } from '@smartimg/shared'

/**
 * A static page written into the share itself, so anyone with the network drive
 * can open it and copy a URL without a server, a login, or anything installed.
 * Thumbnails come straight from CloudFront, and the copy buttons work from a
 * file:// origin, which is how it will actually be opened.
 */
export const GALLERY_FILENAME = '_링크.html'

// The page's style and script are kept as files of their own, so they can be
// edited as CSS and JavaScript rather than as text inside a template. Both are
// inlined into the single HTML file the share gets.
const STYLE = readFileSync(new URL('./gallery.css', import.meta.url), 'utf8')
const SCRIPT = readFileSync(new URL('./gallery.client.js', import.meta.url), 'utf8')

export type GalleryEntry = {
  /** Path inside the share, e.g. 상품/여름/원숭이.jpg */
  readonly sharePath: string
  readonly key: string
  readonly sourceBytes: number
  readonly storedBytes: number
  readonly uploadedAt: string
}

const PRESET_LABELS: Readonly<Record<ImagePreset, string>> = {
  thumbnail: '썸네일',
  productCard: '카드',
  productDetail: '상세',
  hero: '와이드',
}

const PRESET_HINTS: Readonly<Record<ImagePreset, string>> = {
  thumbnail: '200×200',
  productCard: '480×480',
  productDetail: '가로 1200',
  hero: '가로 1920',
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatSeoulTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

function folderOf(sharePath: string): string {
  const cut = sharePath.lastIndexOf('/')
  return cut === -1 ? '' : sharePath.slice(0, cut)
}

function basenameOf(sharePath: string): string {
  const cut = sharePath.lastIndexOf('/')
  return cut === -1 ? sharePath : sharePath.slice(cut + 1)
}

/**
 * The preset offered first. Everything handed to an external channel goes out
 * at this size, so it leads and the rest sit beside it.
 */
const PRIMARY_PRESET: ImagePreset = 'productDetail'

/**
 * The untransformed object URL is deliberately not offered. What sits in S3 is
 * already a compressed 2400px master, kept only so CloudFront has something to
 * resize from — it is not the NAS original and is not meant to be handed out.
 */
const SECONDARY_PRESETS = (Object.keys(IMAGE_PRESETS) as readonly ImagePreset[]).filter(
  (preset) => preset !== PRIMARY_PRESET,
)

function renderCard(entry: GalleryEntry, cdnBase: string): string {
  const name = basenameOf(entry.sharePath)
  // Percent-encoded, not the readable Korean form: these URLs get pasted into
  // external channels whose validators are not reliably happy with non-ASCII.
  const primary = buildImageUrl(cdnBase, entry.key, { preset: PRIMARY_PRESET })
  const thumb = buildImageUrl(cdnBase, entry.key, { preset: 'thumbnail' })

  const buttons = SECONDARY_PRESETS.map((preset) => {
    const url = buildImageUrl(cdnBase, entry.key, { preset })
    return `<button class="u" type="button" data-url="${escapeHtml(url)}" title="${escapeHtml(PRESET_HINTS[preset])}">${escapeHtml(PRESET_LABELS[preset])}</button>`
  }).join('')

  return `<article class="card" data-search="${escapeHtml(entry.sharePath.toLowerCase())}">
  <a class="shot" href="${escapeHtml(primary)}" target="_blank" rel="noopener">
    <img src="${escapeHtml(thumb)}" alt="${escapeHtml(name)}" loading="lazy" width="200" height="200">
  </a>
  <div class="body">
    <p class="name" title="${escapeHtml(entry.sharePath)}">${escapeHtml(name)}</p>
    <p class="meta">${escapeHtml(formatSeoulTime(entry.uploadedAt))}</p>
    <div class="acts">
      <button class="u main" type="button" data-url="${escapeHtml(primary)}">링크 복사 · ${escapeHtml(PRESET_HINTS[PRIMARY_PRESET])}</button>
      <div class="presets">${buttons}</div>
    </div>
  </div>
</article>`
}

export function renderGallery(
  entries: readonly GalleryEntry[],
  cdnBase: string,
  generatedAt: Date = new Date(),
): string {
  const sorted = [...entries].sort((a, b) => a.sharePath.localeCompare(b.sharePath, 'ko'))

  const groups = new Map<string, GalleryEntry[]>()
  for (const entry of sorted) {
    const folder = folderOf(entry.sharePath)
    const bucket = groups.get(folder)
    if (bucket === undefined) groups.set(folder, [entry])
    else bucket.push(entry)
  }

  const sections =
    sorted.length === 0
      ? `<p class="empty">아직 올라간 이미지가 없습니다. 이 폴더에 이미지를 넣으면 잠시 뒤 여기에 나타납니다.</p>`
      : [...groups.entries()]
          .map(
            ([folder, items]) => `<section class="group">
  <h2>${escapeHtml(folder === '' ? '최상위 폴더' : folder)} <span class="count">${items.length}</span></h2>
  <div class="grid">${items.map((entry) => renderCard(entry, cdnBase)).join('\n')}</div>
</section>`,
          )
          .join('\n')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>smartimg 링크</title>
<style>
${STYLE}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>smartimg 링크</h1>
    <p class="sub">이미지 ${sorted.length}개 · 갱신 ${escapeHtml(formatSeoulTime(generatedAt.toISOString()))}</p>
    <input class="search" type="search" id="q" placeholder="파일명 또는 폴더로 검색" autocomplete="off">
  </header>
  <main id="list">
${sections}
  </main>
  <footer>
    이 폴더에 이미지를 넣으면 자동으로 업로드되고 이 목록이 갱신됩니다. 새로 넣은 이미지가 안 보이면 잠시 뒤 새로고침(F5)하세요.<br>
    링크는 모두 크기가 지정된 주소입니다. 무신사·지그재그 같은 외부 채널에는 <b>${escapeHtml(PRESET_HINTS[PRIMARY_PRESET])}</b>를 쓰시면 됩니다.<br>
    파일을 옮기거나 이름을 바꾸면 주소도 따라 바뀌니, 외부에 배포한 뒤에는 그대로 두세요.
  </footer>
</div>
<script>
${SCRIPT}</script>
</body>
</html>
`
}
