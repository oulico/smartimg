// Written to a network share and opened over file://, where the async
// clipboard API is not always granted; the textarea path is the fallback
// that works there.
function copy(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => legacy(text))
  }
  return legacy(text)
}
function legacy(text) {
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(ta)
    ok ? resolve() : reject(new Error('copy failed'))
  })
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button.u')
  if (!button) return
  const label = button.textContent
  copy(button.dataset.url).then(
    () => {
      button.classList.add('copied')
      button.textContent = '복사됨'
      setTimeout(() => {
        button.classList.remove('copied')
        button.textContent = label
      }, 1200)
    },
    () => {
      window.prompt('아래 주소를 복사하세요 (Ctrl+C)', button.dataset.url)
    },
  )
})
const q = document.getElementById('q')
q.addEventListener('input', () => {
  const term = q.value.trim().toLowerCase()
  document.querySelectorAll('.card').forEach((card) => {
    card.classList.toggle('hidden', term !== '' && card.dataset.search.indexOf(term) === -1)
  })
  document.querySelectorAll('.group').forEach((group) => {
    const visible = group.querySelectorAll('.card:not(.hidden)').length
    group.classList.toggle('hidden', visible === 0)
  })
})
