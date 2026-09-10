import { buildImageUrl, IMAGE_PRESETS, type ImagePreset } from '@smartimg/shared'

/**
 * A static page written into the share itself, so anyone with the network drive
 * can open it and copy a URL without a server, a login, or anything installed.
 * Thumbnails come straight from CloudFront, and the copy buttons work from a
 * file:// origin, which is how it will actually be opened.
 */
export const GALLERY_FILENAME = '_링크.html'

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
  :root {
    --ground: #f4f6f5; --surface: #fff; --surface-2: #e9eeec;
    --ink: #141a19; --ink-2: #4d5856; --ink-3: #7a8582;
    --line: #d7dedb; --accent: #0e7c74; --accent-soft: #d8ebe8; --ok: #157f4a;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #0e1413; --surface: #161e1c; --surface-2: #1d2725;
      --ink: #e7edea; --ink-2: #a7b4b0; --ink-3: #76837e;
      --line: #2a3735; --accent: #45b9ac; --accent-soft: #12312e; --ok: #4cc98a;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font: 15px/1.6 "Pretendard", "Malgun Gothic", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1240px; margin: 0 auto; padding: 32px 24px 80px; }
  header { display: flex; flex-direction: column; gap: 14px; margin-bottom: 28px; }
  h1 { margin: 0; font-size: 24px; letter-spacing: -.02em; }
  .sub { margin: 0; color: var(--ink-2); font-size: 14px; }
  .search {
    width: 100%; max-width: 420px; padding: 9px 13px; font: inherit; font-size: 14px;
    border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--ink);
  }
  .search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .group { margin-top: 34px; }
  .group h2 {
    margin: 0 0 14px; font-size: 12px; font-weight: 600; letter-spacing: .1em;
    text-transform: uppercase; color: var(--ink-3);
    padding-bottom: 9px; border-bottom: 1px solid var(--line);
    display: flex; align-items: center; gap: 9px;
  }
  .count { background: var(--surface-2); color: var(--ink-2); border-radius: 20px; padding: 1px 8px; letter-spacing: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 16px; }
  .card {
    background: var(--surface); border: 1px solid var(--line); border-radius: 9px;
    overflow: hidden; display: flex; flex-direction: column;
  }
  .shot { display: block; background: var(--surface-2); line-height: 0; }
  .shot img { width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; display: block; }
  .body { padding: 12px 13px 13px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
  .name {
    margin: 0; font-size: 14px; font-weight: 600; word-break: break-all;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .meta { margin: 0; font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .acts { margin-top: auto; display: flex; flex-direction: column; gap: 7px; }
  .presets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
  button.u {
    font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid var(--line);
    background: var(--surface-2); color: var(--ink-2); padding: 6px 4px; font-size: 12px;
    transition: background .12s, color .12s, border-color .12s;
  }
  button.u:hover { border-color: var(--accent); color: var(--accent); }
  button.u:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button.main {
    padding: 9px; font-size: 13px; font-weight: 600;
    background: var(--accent-soft); color: var(--accent); border-color: var(--accent-soft);
  }
  button.copied, button.main.copied { background: var(--ok); border-color: var(--ok); color: #fff; }
  .empty { color: var(--ink-2); padding: 48px 0; text-align: center; }
  .hidden { display: none !important; }
  footer { margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--ink-3); font-size: 13px; }
  footer code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  @media (prefers-reduced-motion: reduce) { button.u { transition: none; } }
</style>
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
  // Written to a network share and opened over file://, where the async
  // clipboard API is not always granted; the textarea path is the fallback
  // that works there.
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacy(text) })
    }
    return legacy(text)
  }
  function legacy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      document.body.appendChild(ta)
      ta.select()
      var ok = false
      try { ok = document.execCommand('copy') } catch (e) { ok = false }
      document.body.removeChild(ta)
      ok ? resolve() : reject(new Error('copy failed'))
    })
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('button.u')
    if (!button) return
    var label = button.textContent
    copy(button.dataset.url).then(
      function () {
        button.classList.add('copied')
        button.textContent = '복사됨'
        setTimeout(function () {
          button.classList.remove('copied')
          button.textContent = label
        }, 1200)
      },
      function () {
        window.prompt('아래 주소를 복사하세요 (Ctrl+C)', button.dataset.url)
      }
    )
  })
  var q = document.getElementById('q')
  q.addEventListener('input', function () {
    var term = q.value.trim().toLowerCase()
    document.querySelectorAll('.card').forEach(function (card) {
      card.classList.toggle('hidden', term !== '' && card.dataset.search.indexOf(term) === -1)
    })
    document.querySelectorAll('.group').forEach(function (group) {
      var visible = group.querySelectorAll('.card:not(.hidden)').length
      group.classList.toggle('hidden', visible === 0)
    })
  })
</script>
</body>
</html>
`
}
